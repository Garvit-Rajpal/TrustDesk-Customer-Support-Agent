// V5-3 (LLD_v5 §2, HLD_v5 ADR-25): extracted verbatim from the blob markup
// duplicated across Landing.tsx/Login.tsx/Signup.tsx (V3-9 follow-up) so new
// pages (portal, W26) can adopt the same treatment without re-copying it a
// fourth time. Each variant's blob list below is byte-identical to the
// className/position values the pre-extraction pages already used —
// swapping a page onto this component must not change its rendered output.
type Blob = { className: string };

const VARIANTS: Record<"landing" | "auth" | "portal", Blob[]> = {
  landing: [
    {
      className:
        "pointer-events-none absolute -left-32 -top-32 h-96 w-96 animate-blob rounded-full bg-ds-accent/20 blur-3xl",
    },
    {
      className:
        "pointer-events-none absolute right-[-8rem] top-24 h-96 w-96 animate-blob rounded-full bg-status-info-fg/20 blur-3xl [animation-delay:-4s]",
    },
    {
      className:
        "pointer-events-none absolute bottom-[-6rem] left-1/3 h-80 w-80 animate-blob rounded-full bg-status-success-fg/20 blur-3xl [animation-delay:-8s]",
    },
  ],
  auth: [
    {
      className:
        "pointer-events-none absolute -left-24 -top-24 h-72 w-72 animate-blob rounded-full bg-ds-accent/20 blur-3xl",
    },
    {
      className:
        "pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 animate-blob rounded-full bg-status-info-fg/20 blur-3xl [animation-delay:-6s]",
    },
  ],
  // W26: /portal/* visual pass (HLD_v5 ADR-28) — same two-blob auth layout,
  // swapped to accent/success to read distinctly from the login/signup shell.
  portal: [
    {
      className:
        "pointer-events-none absolute -left-24 -top-24 h-72 w-72 animate-blob rounded-full bg-ds-accent/20 blur-3xl",
    },
    {
      className:
        "pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 animate-blob rounded-full bg-status-success-fg/20 blur-3xl [animation-delay:-6s]",
    },
  ],
};

export function GradientBlobBackground({
  variant = "landing",
  blobCount,
}: {
  variant?: "landing" | "auth" | "portal";
  blobCount?: number;
}) {
  const blobs = VARIANTS[variant];
  const shown = blobCount === undefined ? blobs : blobs.slice(0, blobCount);
  return (
    <>
      {shown.map((blob, i) => (
        <div key={i} aria-hidden className={blob.className} />
      ))}
    </>
  );
}
