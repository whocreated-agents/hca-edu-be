import { adminAcademicRoutes } from './admin-academic';
import { adminAdmissionRoutes } from './admin-admissions';
import { adminAuditRoutes, adminContentRoutes } from './admin-content';
import { adminFeeRoutes } from './admin-fees';
import { adminStudentRoutes } from './admin-students';
import { attendanceRoutes } from './attendance';
import { authRoutes } from './auth';
import { parentRoutes } from './parent';
import { publicRoutes } from './public';
import type { RouteDef } from './route';

/** Every V1 endpoint, grouped. The API mounts from this; the web client calls through it. */
export const routes = {
  public: publicRoutes,
  auth: authRoutes,
  parent: parentRoutes,
  attendance: attendanceRoutes,
  adminAcademic: adminAcademicRoutes,
  adminStudents: adminStudentRoutes,
  adminAdmissions: adminAdmissionRoutes,
  adminFees: adminFeeRoutes,
  adminContent: adminContentRoutes,
  adminAudit: adminAuditRoutes,
} as const;

export interface NamedRoute {
  readonly group: keyof typeof routes;
  readonly name: string;
  readonly def: RouteDef;
}

export function allRoutes(): NamedRoute[] {
  return (Object.keys(routes) as (keyof typeof routes)[]).flatMap((group) =>
    Object.entries(routes[group] as Record<string, RouteDef>).map(([name, def]) => ({ group, name, def })),
  );
}
