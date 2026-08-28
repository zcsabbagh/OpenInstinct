import { ImageResponse } from "next/og";

export const alt = "Add details to your Mouse vault";
export const contentType = "image/png";
export const size = { height: 630, width: 1200 };

const BACKGROUND = "#f5f3ed";
const FOREGROUND = "#292927";

/**
 * Link preview for the vault setup link the agent texts over iMessage.
 *
 * This is the moment we ask someone to type a password, arriving as a bare URL
 * in a text message - the exact shape of a phishing text. The card is what
 * makes it recognisably the thing they were just talking to, so it is worth
 * having.
 *
 * Drawn as inline SVG rather than the mouse emoji: `next/og` renders through
 * Satori, which does not draw emoji from system fonts and would otherwise have
 * to fetch them from a CDN on the render path. An inline path has no network
 * dependency and cannot silently degrade to a card with no image.
 */
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: BACKGROUND,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        position: "relative",
        width: "100%",
      }}
    >
      <svg
        fill="none"
        height="340"
        viewBox="0 0 100 100"
        width="340"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="24" cy="30" fill={FOREGROUND} r="17" />
        <circle cx="76" cy="30" fill={FOREGROUND} r="17" />
        <circle cx="50" cy="57" fill={FOREGROUND} r="30" />
        <circle cx="24" cy="28" fill={BACKGROUND} r="8.5" />
        <circle cx="76" cy="28" fill={BACKGROUND} r="8.5" />
        <circle cx="39" cy="52" fill={BACKGROUND} r="4.4" />
        <circle cx="61" cy="52" fill={BACKGROUND} r="4.4" />
        <ellipse cx="50" cy="66" fill={BACKGROUND} rx="5" ry="3.4" />
      </svg>
      <div
        style={{
          bottom: 54,
          color: FOREGROUND,
          display: "flex",
          fontSize: 44,
          letterSpacing: "0.08em",
          opacity: 0.55,
          position: "absolute",
          right: 60,
        }}
      >
        mouse
      </div>
    </div>,
    size
  );
}
