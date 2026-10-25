import { Injectable } from '@nestjs/common';
import type { Relation } from '@hca/contracts';
import { PrismaService } from '../prisma.service';
import type { Principal } from '../common/endpoint';

/**
 * The relationship half of authorisation (BLUEPRINT-001 invariant 3). Called by AccessGuard from
 * the route declaration's `relation`, so no handler has to remember it.
 *
 * Roles that are not PARENT/TEACHER pass through: the route's role list already decided them.
 * Returning false makes the guard answer 404, not 403, so ids cannot be probed for existence.
 */
@Injectable()
export class RelationsService {
  constructor(private readonly prisma: PrismaService) {}

  async allows(p: Principal, relation: Relation, id: string): Promise<boolean> {
    if (relation.resource === 'student') return this.student(p, id);
    return this.section(p, id, relation.teacher);
  }

  private async student(p: Principal, studentId: string): Promise<boolean> {
    if (p.role === 'PARENT') {
      const link = await this.prisma.studentGuardian.findFirst({ where: { studentId, guardian: { userId: p.id } }, select: { id: true } });
      return link !== null;
    }
    if (p.role === 'TEACHER') {
      const hit = await this.prisma.enrollment.findFirst({
        where: {
          studentId,
          state: 'ACTIVE',
          session: { state: 'RUNNING' },
          section: { OR: [{ classTeacher: { userId: p.id } }, { subjectTeachers: { some: { staff: { userId: p.id } } } }] },
        },
        select: { id: true },
      });
      return hit !== null;
    }
    return true;
  }

  private async section(p: Principal, sectionId: string, teacher: 'class' | 'any'): Promise<boolean> {
    if (p.role === 'PARENT' || p.role === 'STUDENT') return false;
    if (p.role !== 'TEACHER') return true;
    const hit = await this.prisma.section.findFirst({
      where: {
        id: sectionId,
        OR: [
          { classTeacher: { userId: p.id } },
          ...(teacher === 'any' ? [{ subjectTeachers: { some: { staff: { userId: p.id } } } }] : []),
        ],
      },
      select: { id: true },
    });
    return hit !== null;
  }
}
