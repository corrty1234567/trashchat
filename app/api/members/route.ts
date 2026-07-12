import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createMember, getMembers } from "@/lib/members";

export const runtime = "nodejs";

const createMemberSchema = z.object({
  name: z.string()
});

export async function GET() {
  const members = await getMembers();

  return NextResponse.json({ members });
}

export async function POST(request: Request) {
  const adminError = requireAdmin(request);

  if (adminError) {
    return adminError;
  }

  const parsed = createMemberSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await createMember(parsed.data.name);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ member: result.member }, { status: 201 });
}
