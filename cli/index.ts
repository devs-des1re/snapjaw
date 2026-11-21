import { parseArgs } from "node:util";
import { logger } from "../lib/logger";
import { adminCommand } from "./admin";

const usage = `Usage: snapjaw <command> [options]

Commands:
  admin create --email <email> [--name <name>] [--role owner|admin|viewer] [--password-stdin]
  admin reset-password --email <email> [--password-stdin]
  admin reset-2fa --email <email>
  doctor
  backup <file>
  restore <file>
`;

export type Write = (text: string) => void;

const out: Write = (text) => process.stdout.write(`${text}\n`);

try {
  process.loadEnvFile(".env");
} catch {
  out("No .env file in the current folder. Using the environment as it is.");
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    out(usage);
    return 0;
  }
  if (command === "admin") return adminCommand(rest, out);
  if (command === "doctor") {
    const { doctorCommand } = await import("./doctor");
    return doctorCommand(out);
  }
  if (command === "backup" || command === "restore") {
    const { backupCommand, restoreCommand } = await import("./backup");
    const { positionals } = parseArgs({ args: rest, allowPositionals: true });
    const file = positionals[0];
    if (!file) {
      out(usage);
      return 2;
    }
    return command === "backup" ? backupCommand(file, out) : restoreCommand(file, out);
  }
  out(usage);
  return 2;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
