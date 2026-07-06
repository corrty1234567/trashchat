import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_MEMBERS, type Member, type Sender } from "@/lib/types";

export const MEMBER_NAME_MAX_LENGTH = 24;
const MEMBER_NAME_PATTERN = /^[^\s@]{1,24}$/u;

type DbMember = {
  id: string;
  name: string;
  isProtected: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function normalizeMemberName(name: string) {
  return name.trim();
}

export function validateMemberName(name: string) {
  const normalizedName = normalizeMemberName(name);

  if (!MEMBER_NAME_PATTERN.test(normalizedName)) {
    return {
      ok: false as const,
      error: `Name must be 1-${MEMBER_NAME_MAX_LENGTH} characters without spaces or @.`
    };
  }

  return {
    ok: true as const,
    name: normalizedName
  };
}

export function serializeMember(member: DbMember): Member {
  return {
    id: member.id,
    name: member.name,
    isProtected: member.isProtected,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString()
  };
}

export async function ensureDefaultMembers() {
  await prisma.member.createMany({
    data: DEFAULT_MEMBERS.map((member) => ({
      id: member.id,
      name: member.name,
      isProtected: member.isProtected
    })),
    skipDuplicates: true
  });
}

function sortMembers(members: DbMember[]) {
  const protectedOrder = new Map<string, number>(DEFAULT_MEMBERS.map((member, index) => [member.id, index]));

  return [...members].sort((first, second) => {
    const firstOrder = protectedOrder.get(first.id);
    const secondOrder = protectedOrder.get(second.id);

    if (firstOrder !== undefined || secondOrder !== undefined) {
      return (firstOrder ?? Number.MAX_SAFE_INTEGER) - (secondOrder ?? Number.MAX_SAFE_INTEGER);
    }

    return first.createdAt.getTime() - second.createdAt.getTime();
  });
}

export async function getMembers() {
  await ensureDefaultMembers();

  const members = await prisma.member.findMany({
    orderBy: {
      createdAt: "asc"
    }
  });

  return sortMembers(members).map(serializeMember);
}

export async function memberExists(sender: Sender) {
  await ensureDefaultMembers();

  const count = await prisma.member.count({
    where: {
      id: sender
    }
  });

  return count > 0;
}

export async function createMember(name: string) {
  const validated = validateMemberName(name);

  if (!validated.ok) {
    return validated;
  }

  try {
    const member = await prisma.member.create({
      data: {
        id: `member-${crypto.randomUUID()}`,
        name: validated.name
      }
    });

    return {
      ok: true as const,
      member: serializeMember(member)
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        ok: false as const,
        error: "Name already exists."
      };
    }

    throw error;
  }
}
