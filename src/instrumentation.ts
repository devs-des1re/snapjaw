export async function register() {
  const { boot } = await import("../server/boot");
  await boot();
}
