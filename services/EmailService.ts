export function buildMailtoUrl({
  to,
  subject,
  body,
}: {
  to: string[];
  subject: string;
  body: string;
}) {
  const params = new URLSearchParams({
    subject,
    body,
  });

  return `mailto:${to.join(',')}?${params.toString()}`;
}
