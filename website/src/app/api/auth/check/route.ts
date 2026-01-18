import { NextResponse } from "next/server";

/**
 * POST /api/auth/check
 * 
 * Input: { password: string }
 * 
 * Returns: { authenticated: boolean }
 */
export async function POST(req: Request) {
  try {
    const { password } = await req.json();

    const correctPassword = process.env.APP_ACCESS_PASSWORD;

    if (!correctPassword) {
      return NextResponse.json(
        { error: "APP_ACCESS_PASSWORD environment variable is not configured" },
        { status: 500 }
      );
    }

    if (password === correctPassword) {
      return NextResponse.json({ authenticated: true });
    }

    return NextResponse.json({ authenticated: false }, { status: 401 });
  } catch (e: any) {
    console.error("auth check error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

