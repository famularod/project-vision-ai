import { supabase } from '../lib/supabase';

const PROJECT_UPDATES_TABLE = 'project_updates';

type CloudUpdateRow<TUpdate> = {
  update_data: TUpdate | null;
};

type ProjectUpdateLike = {
  id: string;
  projectName?: string;
  selectedAreaName?: string | null;
};

export async function loadCloudUpdates<TUpdate>(): Promise<TUpdate[]> {
  const { data, error } = await supabase
    .from(PROJECT_UPDATES_TABLE)
    .select('update_data')
    .order('created_at', { ascending: false });

  if (error) {
    console.log('Supabase updates load failed:', error.message);
    return [];
  }

  return Array.isArray(data)
    ? (data as CloudUpdateRow<TUpdate>[])
        .map(row => row.update_data)
        .filter((update): update is TUpdate => Boolean(update))
    : [];
}

export async function saveCloudUpdate<TUpdate extends ProjectUpdateLike>(
  update: TUpdate,
): Promise<void> {
  if (!update.id) return;

  const { error, status } = await supabase
    .from(PROJECT_UPDATES_TABLE)
    .upsert({
      id: update.id,
      project_name: update.projectName || 'Unassigned Project',
      area_name: update.selectedAreaName || '',
      update_data: update,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.log('Supabase update save failed:', error.message);
    return;
  }

  console.log('Supabase update saved:', update.id, `status=${status}`);
}
