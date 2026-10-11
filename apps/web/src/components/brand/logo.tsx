import Image from "next/image";
import Link from "next/link";

import logo from "../../../public/brand/sonder-logo.png";

/** The Sonder mark, optionally with the wordmark, linking home. */
export function SonderLogo({
  size = 32,
  wordmark = true,
  href = "/",
  className = "",
}: {
  size?: number;
  wordmark?: boolean;
  href?: string | null;
  className?: string;
}) {
  const content = (
    <>
      <Image
        src={logo}
        alt={wordmark ? "" : "Sonder"}
        width={size}
        height={size}
        className="shrink-0 drop-shadow-[0_4px_16px_rgba(139,92,246,0.35)]"
        loading="eager"
      />
      {wordmark && (
        <span className="text-[1.05rem] font-semibold tracking-tight text-zinc-50">Sonder</span>
      )}
    </>
  );
  const classes = `inline-flex items-center gap-2.5 rounded-lg ${className}`;
  return href ? (
    <Link
      href={href}
      className={`${classes} focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan`}
    >
      {content}
    </Link>
  ) : (
    <span className={classes}>{content}</span>
  );
}
