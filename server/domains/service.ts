import { recordAudit } from "../../db/queries/audit";
import { deleteDomainRow, findDomainByName, getDomainRow, insertDomain, listDomainRows, updateDomainRow } from "../../db/queries/domains";
import { isDomain } from "../../lib/address";
import { newId } from "../../lib/crypto";
import { logger } from "../../lib/logger";
import type { Actor } from "../http/guard";
import { createDomain, deleteDomain, getDomain, listDomains, updateDomain, verifyDomain, type ResendDomain } from "../resend/api";
import { explainResendError, ResendError } from "../resend/client";

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

function fromResend(domain: ResendDomain) {
  return {
    status: domain.status,
    region: domain.region ?? null,
    sending: domain.capabilities?.sending !== "disabled",
    receiving: domain.capabilities?.receiving === "enabled",
    records: domain.records ?? [],
    checkedAt: new Date(),
  };
}

function failure(error: unknown): { ok: false; status: number; error: string } {
  const explained = explainResendError(error);
  return { ok: false, status: error instanceof ResendError && error.status >= 400 && error.status < 500 ? 422 : 502, error: `${explained.message} ${explained.fix}` };
}

export async function addDomain(actor: Actor, input: Record<string, unknown>): Promise<Result<{ id: string }>> {
  const name = typeof input.name === "string" ? input.name.trim().toLowerCase() : "";
  if (!isDomain(name)) return { ok: false, status: 422, error: "Enter a domain such as example.com or mail.example.com." };
  if (await findDomainByName(name)) return { ok: false, status: 409, error: `${name} is already in Snapjaw.` };
  const receiving = input.receiving !== false;
  const region = typeof input.region === "string" && input.region ? input.region : undefined;
  let remote: ResendDomain;
  try {
    const existing = (await listDomains()).data.find((domain) => domain.name.toLowerCase() === name);
    if (existing) {
      remote = await getDomain(existing.id);
      if (receiving && remote.capabilities?.receiving !== "enabled") {
        await updateDomain(existing.id, { capabilities: { receiving: "enabled" } }).catch((error: unknown) => logger.warn(`Could not enable receiving for ${name}: ${explainResendError(error).message}`));
        remote = await getDomain(existing.id);
      }
    } else {
      const created = await createDomain(name, receiving, region);
      remote = created.records ? created : await getDomain(created.id);
    }
  } catch (error) {
    return failure(error);
  }
  const id = newId("dom");
  await insertDomain({ id, resendId: remote.id, name, ...fromResend(remote) });
  await recordAudit(actor, "domain.add", name, { resendId: remote.id, receiving });
  return { ok: true, data: { id } };
}

export async function refreshDomain(id: string, triggerVerify: boolean): Promise<Result<{ status: string }>> {
  const row = await getDomainRow(id);
  if (!row?.resendId) return { ok: false, status: 404, error: "No such domain." };
  try {
    if (triggerVerify) await verifyDomain(row.resendId);
    const remote = await getDomain(row.resendId);
    await updateDomainRow(id, fromResend(remote));
    return { ok: true, data: { status: remote.status } };
  } catch (error) {
    return failure(error);
  }
}

export async function recheckDomain(actor: Actor, id: string) {
  const result = await refreshDomain(id, true);
  if (result.ok) await recordAudit(actor, "domain.verify", id, { status: result.data.status });
  return result;
}

export async function removeDomain(actor: Actor, id: string, alsoInResend: boolean): Promise<Result<Record<string, never>>> {
  const row = await getDomainRow(id);
  if (!row) return { ok: false, status: 404, error: "No such domain." };
  if (alsoInResend && row.resendId) {
    try {
      await deleteDomain(row.resendId);
    } catch (error) {
      return failure(error);
    }
  }
  await deleteDomainRow(id);
  await recordAudit(actor, "domain.remove", row.name, { alsoInResend });
  return { ok: true, data: {} };
}

export async function refreshPendingDomains() {
  const rows = await listDomainRows();
  for (const row of rows) {
    const stale = !row.checkedAt || Date.now() - row.checkedAt.getTime() > (row.status === "verified" ? 6 * 3600_000 : 10 * 60_000);
    if (!stale) continue;
    const result = await refreshDomain(row.id, false);
    if (!result.ok) logger.warn(`Domain check for ${row.name} failed: ${result.error}`);
  }
}
