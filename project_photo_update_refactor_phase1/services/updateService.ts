import { supabase } from '../lib/supabase';

export async function loadCloudUpdates<TUpdate>() {
  const { data, error } = await supabase
    .from('project_updates')
    .select('update_data')
    .order('created_at', { ascending: false });

  if (error) {
    console.log('Supabase updates load failed:', error.message);
    return [];
  }

  return Array.isArray(data)
    ? data
        .map(row => row.update_data as TUpdate)
        .filter(Boolean)
    : [];
}

export function saveCloudUpdate(update: any) {
  const cloudUpdate = JSON.parse(JSON.stringify(update));

  console.log('Supabase update save started:', update.id);

  supabase
    .from('project_updates')
    .upsert(
      {
        id: update.id,
        project_name: update.projectName || 'Untitled Project',
        area_name: update.selectedAreaName || '',
        update_date: new Date().toISOString(),
        update_data: cloudUpdate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    .then(result => {
      console.log('SUPABASE UPDATE RESULT:', JSON.stringify(result, null, 2));

      if (result.error) {
        console.log('Supabase update save failed:', result.error.message);
      } else {
        console.log('Supabase update saved:', update.id);
      }
    })
    .catch(error => {
      console.log('SUPABASE UPDATE EXCEPTION:', error);
    });
}
