export async function readJson(
  req: Request,
  maxBytes = 8192,
): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw Error("Enter the form details.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw Error("The form is too large. Keep each field within its limit.");
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
    return body;
  } catch {
    throw Error("Enter valid form details.");
  }
}
