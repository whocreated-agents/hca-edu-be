import { routes, yearsSince } from '@hca/contracts';
import { call } from '../lib/api';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let profile: Awaited<ReturnType<typeof load>> | null = null;
  try {
    profile = await load();
  } catch {
    profile = null;
  }
  if (!profile) return <main><p>School information is temporarily unavailable.</p></main>;
  return (
    <main>
      <h1>{profile.name}</h1>
      <p>{yearsSince(profile.foundedOn)} years of service</p>
    </main>
  );
}

function load() {
  return call(routes.public.profile, {});
}
