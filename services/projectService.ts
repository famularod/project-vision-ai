import { supabase } from '../lib/supabase';

export async function loadCloudProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('name')
    .eq('archived', false)
    .order('created_at', { ascending: false });

  if (error) {
    console.log('Supabase project load failed:', error.message);
    return [];
  }

  return Array.isArray(data)
    ? data
        .map(item => item.name)
        .filter(name => typeof name === 'string' && name.trim())
    : [];
}

export function saveCloudProject(projectName: string) {
  Promise.resolve(
    supabase
      .from('projects')
      .insert({
        name: projectName,
        status: 'Active',
        archived: false,
        is_favorite: false,
      }),
  )
    .then(({ error }) => {
      if (error) {
        console.log('Supabase project save failed:', error.message);
      } else {
        console.log('Supabase project saved:', projectName);
      }
    })
    .catch(error => {
      console.log('Supabase project save exception:', error);
    });
}
