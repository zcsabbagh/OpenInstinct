import Image, { type ImageProps } from "next/image";
import { cn } from "@/lib/utils";
import mouseLogoMark from "./mouse-logo-mark.png";

type LogoProps = Omit<ImageProps, "alt" | "src"> & {
  readonly alt?: string;
};

/**
 * The Mouse mark: a hand-drawn mouse head with a red heart, cropped from the
 * full illustration in app/vault/mouse-logo.ts. The full body (ears, torso,
 * curled tail, three hearts) only reads at a few hundred pixels - at the
 * sizes this renders (28-36px) it turns to mush, so this crop keeps just the
 * head and one heart, which stays legible down to icon size.
 *
 * This is a raster illustration, not a monochrome vector, so unlike the
 * previous placeholder it does not adapt to the foreground/primary theme
 * tokens - it carries its own fixed cream/black/red palette. The app has no
 * dark-mode toggle wired up today (no ThemeProvider applies `.dark`), so
 * that isn't currently a visible tradeoff.
 */
function Logo({ className, alt = "Mouse", ...props }: LogoProps) {
  return (
    <Image
      alt={alt}
      className={cn("size-5 shrink-0 object-contain", className)}
      src={mouseLogoMark}
      {...props}
    />
  );
}

export { Logo };
export type { LogoProps };
