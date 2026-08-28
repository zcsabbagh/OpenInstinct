import { ImageResponse } from "next/og";
import { MOUSE_LOGO_DATA_URL } from "./mouse-logo";

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
 * The mark is the real Mouse logo (a hand-drawn mouse with hearts) embedded as
 * a base64 data URI in ./mouse-logo, not read from disk at request time: this
 * route builds static, so the string is inlined at build time and the image
 * has no network dependency and cannot silently degrade to a card with no
 * image.
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
      <img
        alt=""
        height={390}
        src={MOUSE_LOGO_DATA_URL}
        style={{ objectFit: "contain" }}
        width={390}
      />
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
