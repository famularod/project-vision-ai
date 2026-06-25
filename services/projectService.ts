import { supabase } from '../lib/supabase';

const PROJECTS_TABLE = 'projects';

type ProjectRow = {
  name: string | null;
};

export async function loadCloudProjects(): Promise<string[]> {
  const { data, error } = await supabase
    .from(PROJECTS_TABLE)
    .select('name')
    .eq('archived', false)
    .order('created_at', { ascending: false });

  if (error) {
    console.log('Supabase project load failed:', error.message);
    return [];
  }

  return Array.isArray(data)
    ? (data as ProjectRow[])
        .map(row => row.name)
        .filter((name): name is string =>
          typeof name === 'string' && name.trim().length > 0,
        )
    : [];
}

export async function saveCloudProject(projectName: string): Promise<void> {
  const trimmed = projectName.trim();

  if (!trimmed) return;

  const { error } = await supabase
    .from(PROJECTS_TABLE)
    .insert({
      name: trimmed,
      status: 'Active',
      archived: false,
      is_favorite: false,
    });

  if (error) {
    console.log('Supabase project save failed:', error.message);
    return;
  }

  console.log('Supabase project saved:', trimmed);
}
