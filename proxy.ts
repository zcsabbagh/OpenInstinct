import { NextResponse, type NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth/session";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (
    pathname === "/sign-in" ||
    // Next serves the app/icon.png metadata route here. A browser asks for
    // the favicon before anyone signs in, and the matcher below only
    // exempts favicon.ico, so without this the tab icon is a redirect to
    // the sign-in page and never renders.
    pathname === "/icon.png" ||
    pathname === "/google-connected" ||
    // Where Vercel Connect sends the browser back after Google OAuth. The
    // redirect carries no session cookie, so without this the callback is
    // bounced to /sign-in: the user lands on a phone-number form instead of
    // the confirmation page, and the proactive "we're in" message never
    // fires because the route never runs. The handler re-verifies the
    // workspace against the live connection and is claimOnce-guarded, so
    // reaching it without a session cannot fabricate a message.
    pathname === "/internal/google-connect-notify" ||
    // The contact card is opened by someone who just texted Mouse for the
    // first time and, by definition, has never signed in - either as a
    // tapped link or fetched by Linq to attach to the thread. Same shape of
    // fix as /icon.png below: without this it 307s to /sign-in and the vCard
    // never loads.
    pathname === "/contact.vcf" ||
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
