import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleProp,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { AddProjectCard } from '../components/AddProjectCard';
import { ManageAreasPanel } from '../components/ManageAreasPanel';
import { ProjectFinderRow } from '../components/ProjectFinderRow';
import {
  EmptyState,
  MiniStat,
  ScreenTitle,
  SecondaryButton,
  colors,
  styles,
} from '../components/ProjectDetailsCard';
import {
  getStoredJson,
  setStoredJson,
} from '../services/StorageService';
import {
  EMPTY_PROJECT_STATS,
  ProjectArea,
  ProjectStats,
  ProjectUpdate,
  ScheduleItem,
} from '../types';
import { buildScheduleSummary } from '../utils/schedule';

export function ProjectsScreen({
  contentStyle,
  activeProjects,
  archivedProjects,
  savedUpdates,
  scheduleItems,
  projectStatsByName,
  projectAreas,
  onSelect,
  onAddProject,
  onCloseProject,
  onReopenProject,
  onRenameProject,
  onDeleteProject,
  onBackup,
  onRestore,
  onAddArea,
  onUpdateArea,
  onDeleteArea,
  onUseCurrentLocationForArea,
  onDiagnostics,
  onReferenceDocuments,
  onSchedule,
  onConstructionTimeline,
}: {
  contentStyle: StyleProp<ViewStyle>;
  activeProjects: string[];
  archivedProjects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  projectStatsByName: Record<string, ProjectStats>;
  projectAreas: ProjectArea[];
  onSelect: (projectName: string) => void;
  onAddProject: (projectName: string) => boolean;
  onCloseProject: (projectName: string) => void;
  onReopenProject: (projectName: string) => void;
  onRenameProject: (projectName: string, nextName: string) => boolean;
  onDeleteProject: (projectName: string) => void;
  onBackup: () => void;
  onRestore: () => void;
  onAddArea: (name: string) => boolean;
  onUpdateArea: (areaId: string, next: Partial<ProjectArea>) => void;
  onDeleteArea: (areaId: string) => void;
  onUseCurrentLocationForArea: (areaId: string) => void;
  onDiagnostics: () => void;
  onReferenceDocuments: () => void;
  onSchedule: () => void;
  onConstructionTimeline?: () => void;
}) {
  const [searchText, setSearchText] = useState('');
  const [projectFilter, setProjectFilter] = useState<
    'All' | 'Favorites' | 'Open' | 'Overdue' | 'Due Soon' | 'Archived'
  >('All');
  const [favoriteProjects, setFavoriteProjects] = useState<string[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);

  useEffect(() => {
    getStoredJson<unknown>('projectPhotoUpdate.favoriteProjects.v1', [])
      .then(parsed => {
        if (Array.isArray(parsed)) {
          setFavoriteProjects(
            parsed.filter(item => typeof item === 'string'),
          );
        }
      })
      .catch(() => undefined)
      .finally(() => setFavoritesLoaded(true));
  }, []);

  useEffect(() => {
    if (!favoritesLoaded) return;

    setStoredJson(
      'projectPhotoUpdate.favoriteProjects.v1',
      favoriteProjects,
    ).catch(() => undefined);
  }, [favoriteProjects, favoritesLoaded]);

  function toggleFavorite(projectName: string) {
    setFavoriteProjects(prev => {
      const exists = prev.some(
        item => item.toLowerCase() === projectName.toLowerCase(),
      );

      if (exists) {
        return prev.filter(
          item => item.toLowerCase() !== projectName.toLowerCase(),
        );
      }

      return [projectName, ...prev];
    });
  }

  function requestRenameProject(projectName: string) {
    Alert.prompt(
      'Rename Project',
      `Enter a new name for ${projectName}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (value?: string) => {
            const nextName = (value || '').trim();
            const renamed = onRenameProject(projectName, nextName);

            if (!renamed) return;

            setFavoriteProjects(prev =>
              prev.map(item =>
                item.toLowerCase() === projectName.toLowerCase()
                  ? nextName
                  : item,
              ),
            );
          },
        },
      ],
      'plain-text',
      projectName,
    );
  }

  function requestDeleteProject(projectName: string) {
    Alert.alert(
      'Delete Project?',
      `Project: ${projectName}\n\nThis cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setFavoriteProjects(prev =>
              prev.filter(
                item => item.toLowerCase() !== projectName.toLowerCase(),
              ),
            );
            onDeleteProject(projectName);
          },
        },
      ],
    );
  }

  const activeProjectSet = new Set(
    activeProjects.map(project => project.toLowerCase()),
  );
  const archivedProjectSet = new Set(
    archivedProjects.map(project => project.toLowerCase()),
  );
  const search = searchText.trim().toLowerCase();

  const projectRows = [
    ...activeProjects.map(project => ({
      project,
      archived: false,
      stats: projectStatsByName[project] || EMPTY_PROJECT_STATS,
    })),
    ...archivedProjects.map(project => ({
      project,
      archived: true,
      stats: projectStatsByName[project] || EMPTY_PROJECT_STATS,
    })),
  ]
    .filter(item => {
      const favorite = favoriteProjects.some(
        project => project.toLowerCase() === item.project.toLowerCase(),
      );

      if (projectFilter === 'Favorites' && !favorite) return false;
      if (projectFilter === 'Open' && item.archived) return false;
      if (projectFilter === 'Archived' && !item.archived) return false;
      if (projectFilter === 'Overdue' && item.stats.overdueActions === 0) {
        return false;
      }
      if (projectFilter === 'Due Soon' && item.stats.dueThisWeek === 0) {
        return false;
      }

      if (!search) return true;

      return item.project.toLowerCase().includes(search);
    })
    .sort((a, b) => {
      const aFavorite = favoriteProjects.some(
        project => project.toLowerCase() === a.project.toLowerCase(),
      );
      const bFavorite = favoriteProjects.some(
        project => project.toLowerCase() === b.project.toLowerCase(),
      );

      if (aFavorite !== bFavorite) return aFavorite ? -1 : 1;
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      if (b.stats.overdueActions !== a.stats.overdueActions) {
        return b.stats.overdueActions - a.stats.overdueActions;
      }
      if (b.stats.openActions !== a.stats.openActions) {
        return b.stats.openActions - a.stats.openActions;
      }

      return a.project.localeCompare(b.project);
    });

  const totalPhotos = savedUpdates.reduce(
    (sum, update) => sum + update.photos.length,
    0,
  );
  const totalOpenActions = Object.values(projectStatsByName).reduce(
    (sum, stats) => sum + stats.openActions,
    0,
  );
  const totalOverdue = Object.values(projectStatsByName).reduce(
    (sum, stats) => sum + stats.overdueActions,
    0,
  );

  const renderProject = ({ item }: { item: typeof projectRows[number] }) => {
    const favorite = favoriteProjects.some(
      project => project.toLowerCase() === item.project.toLowerCase(),
    );

    return (
      <ProjectFinderRow
        project={item.project}
        stats={item.stats}
        scheduleSummary={buildScheduleSummary(scheduleItems, {
          projectName: item.project,
        })}
        archived={item.archived}
        favorite={favorite}
        onPress={() =>
          item.archived ? onReopenProject(item.project) : onSelect(item.project)
        }
        onFavorite={() => toggleFavorite(item.project)}
        onRename={() => requestRenameProject(item.project)}
        onClose={
          item.archived ? undefined : () => onCloseProject(item.project)
        }
        onRestore={
          item.archived ? () => onReopenProject(item.project) : undefined
        }
        onDelete={() => requestDeleteProject(item.project)}
      />
    );
  };

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      data={projectRows}
      keyExtractor={item => `${item.archived ? 'archived' : 'active'}-${item.project}`}
      renderItem={renderProject}
      ListHeaderComponent={
        <>
          <ScreenTitle
            title="Projects"
            subtitle="Search, favorite, update, archive, and manage project setup."
          />

          <View style={styles.projectFinderPanel}>
            <View style={styles.projectSearchBox}>
              <Ionicons
                name="search-outline"
                size={19}
                color={colors.muted}
              />

              <TextInput
                style={styles.projectSearchInput}
                value={searchText}
                onChangeText={setSearchText}
                placeholder="Search projects"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />

              {searchText.trim() ? (
                <TouchableOpacity onPress={() => setSearchText('')}>
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={colors.muted}
                  />
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.projectFilterRow}>
              {(['All', 'Favorites', 'Open', 'Overdue', 'Due Soon', 'Archived'] as const).map(filter => {
                const selected = projectFilter === filter;

                return (
                  <TouchableOpacity
                    key={filter}
                    style={[
                      styles.projectFilterChip,
                      selected && styles.projectFilterChipSelected,
                    ]}
                    onPress={() => setProjectFilter(filter)}
                  >
                    <Text
                      style={[
                        styles.projectFilterText,
                        selected && styles.projectFilterTextSelected,
                      ]}
                    >
                      {filter}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.projectFinderStatsRow}>
              <MiniStat label="Active" value={activeProjectSet.size} />
              <MiniStat label="Archived" value={archivedProjectSet.size} />
              <MiniStat label="Open" value={totalOpenActions} danger={totalOpenActions > 0} />
              <MiniStat label="Overdue" value={totalOverdue} danger={totalOverdue > 0} />
            </View>

            <Text style={styles.locationDetailText}>
              {projectRows.length} project{projectRows.length === 1 ? '' : 's'} shown | {totalPhotos.toLocaleString('en-US')} total photos
            </Text>
          </View>

          <AddProjectCard
            buttonLabel="Add Project"
            placeholder="New project name"
            onAdd={onAddProject}
          />

          <SecondaryButton
            label="Reference Documents"
            icon="documents-outline"
            onPress={onReferenceDocuments}
          />

          <SecondaryButton
            label="Schedule"
            icon="calendar-outline"
            onPress={onSchedule}
          />

          {onConstructionTimeline ? (
            <SecondaryButton
              label="Construction Timeline"
              icon="git-branch-outline"
              onPress={onConstructionTimeline}
            />
          ) : null}

          <ManageAreasPanel
            projectAreas={projectAreas}
            onAddArea={onAddArea}
            onUpdateArea={onUpdateArea}
            onDeleteArea={onDeleteArea}
            onUseCurrentLocationForArea={onUseCurrentLocationForArea}
          />

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>
              Data Management
            </Text>

            <Text style={styles.bodyText}>
              JSON backup protects project data and local photo references. It does not copy image files outside this app.
            </Text>

            <View style={styles.dataActionRow}>
              <SecondaryButton
                label="Backup"
                icon="download-outline"
                onPress={onBackup}
                compact
              />

              <SecondaryButton
                label="Restore"
                icon="cloud-upload-outline"
                onPress={onRestore}
                compact
              />
            </View>

            <SecondaryButton
              label="Run Diagnostics"
              icon="pulse-outline"
              onPress={onDiagnostics}
            />
          </View>

          <Text style={styles.sectionLabel}>
            Project Finder
          </Text>
        </>
      }
      ListEmptyComponent={
        <EmptyState
          title="No matching projects"
          text="Change the search or filter, or add a new project."
        />
      }
    />
  );
}
