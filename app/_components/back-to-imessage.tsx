import { messagesHref } from "@/lib/imessage-link";

/**
 * Sends the user back to the Mouse thread after they finish on a web page.
 */
export function BackToIMessage({
  label = "Back to Mouse",
  phoneNumber,
}: {
  readonly label?: string;
  readonly phoneNumber: string | undefined;
}) {
  return (
    <a
      className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
      href={messagesHref(phoneNumber)}
    >
      <svg
        aria-hidden="true"
        className="size-4"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M12 3C6.48 3 2 6.69 2 11.25c0 2.62 1.49 4.96 3.83 6.5-.19 1.06-.79 2.52-1.74 3.55-.2.21-.03.56.26.51 2.03-.35 3.66-1.15 4.81-1.87.86.2 1.76.31 2.72.31 5.52 0 10-3.69 10-8.34S17.52 3 12 3z" />
      </svg>
      {label}
    </a>
  );
}
