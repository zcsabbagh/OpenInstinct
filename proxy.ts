import { NextResponse, type NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth/session";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (
    pathname === "/sign-in" ||
    pathname === "/google-connected" ||
    // The vault setup link is texted to the user, so a cookieless link
    // preview fetcher has to reach the page and its opengraph-image to
    // render a card. Nothing sensitive renders server-side: the page only
    // reads its query string, the shell is a client component, and every
    // vault value comes from /api/manager, which stays gated.
    pathname === "/vault" ||
    pathname.startsWith("/vault/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/internal/model-smoke" ||
    pathname === "/eve/v1/health"
  ) {
    return NextResponse.next();
  }

  if (await getAuthSession(request.headers)) return NextResponse.next();

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set(
    "callbackUrl",
    `${request.nextUrl.pathname}${request.nextUrl.search}`
  );
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
