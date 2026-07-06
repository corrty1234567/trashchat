import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureDefaultMembers, serializeMember, validateMemberName } from "@/lib/members";

export const runtime = "nodejs";

const updateMemberSchema = z.object({
  name: z.string()
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = updateMemberSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const validated = validateMemberName(parsed.data.name);

  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  await ensureDefaultMembers();

  try {
    const member = await prisma.member.update({
      where: { id },
      data: {
        name: validated.name
      }
    });

    return NextResponse.json({ member: serializeMember(member) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Name already exists." }, { status: 400 });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Member not found." }, { status: 404 });
    }

    throw error;
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  await ensureDefaultMembers();

  const member = await prisma.member.findUnique({
    where: { id }
  });

  if (!member) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  if (member.isProtected) {
    return NextResponse.json({ error: "Protected members cannot be deleted." }, { status: 403 });
  }

  await prisma.member.delete({
    where: { id }
  });

  return NextResponse.json({ ok: true });
}
