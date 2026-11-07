// Browser upload: the file goes directly to a private, short-lived staging URL.
// Finalization on our server checks the original bytes before attaching it.
export async function uploadSchoolPaper(file: File) {
  if (
    !file.size ||
    file.size > 10 * 1024 * 1024 ||
    !["application/pdf", "image/png", "image/jpeg"].includes(file.type)
  )
    throw Error(
      "Choose a JPEG, PNG or PDF up to 10 MB. Your other fields are kept.",
    );
  const prepared = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mime: file.type, size: file.size }),
  });
  const upload = await prepared.json();
  if (!prepared.ok) throw Error(upload.error);
  const sent = await fetch(upload.url, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
      "x-upsert": "false",
      apikey: upload.publishableKey,
    },
    body: file,
    credentials: "omit",
  });
  if (!sent.ok)
    throw Error(
      "The file upload did not finish. Your fields are kept; please retry.",
    );
  return upload.id as string;
}
