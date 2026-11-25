import { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export function pairKey(a: string, b: string) {
  return [a, b].sort().join(':');
}

export async function socialTransaction<T>(
  prisma: PrismaService,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel:
          Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new ConflictException('Please retry the operation');
}
