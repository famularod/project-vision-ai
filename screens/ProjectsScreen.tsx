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
import { ProjectFinderRow } from '../components/ProjectFinderRow';
import {
  EmptyState,
  ScreenTitle,
  colors,
  styles,
} from '../components/ProjectDetailsCard';
import { buildRuntime } from '../services/PIERuntime';
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
  projectAreas,
  projectStatsByName,
  onSelect,
  onUpdateProject,
  onAddProject,
  onCloseProject,
  onReopenProject,
  onRenameProject,
  onDeleteProject,
}: {
  contentStyle: StyleProp<ViewStyle>;
  activeProjects: string[];
  archivedProjects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  projectAreas: ProjectArea[];
  projectStatsByName: Record<string, ProjectStats>;
  onSelect: (projectName: string) => void;
  onUpdateProject?: (projectName: string) => void;
  onAddProject: (projectName: string) => boolean;
  onCloseProject: (projectName: string) => void;
  onReopenProject: (projectName: string) => void;
  onRenameProject: (projectName: string, nextName: string) => boolean;
  onDeleteProject: (projectName: string) => void;
}) {
  const [searchText, setSearchText] = useState('');
  const [projectFilter, setProjectFilter] = useState<
    'Active' | 'Favorites' | 'Archived'
  >('Active');
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

      if (projectFilter === 'Active' && item.archived) return false;
      if (projectFilter === 'Favorites' && !favorite) return false;
      if (projectFilter === 'Archived' && !item.archived) return false;

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
      const aSchedule = buildScheduleSummary(scheduleItems, {
        projectName: a.project,
      });
      const bSchedule = buildScheduleSummary(scheduleItems, {
        projectName: b.project,
      });
      const aPriority =
        a.stats.overdueActions * 80 +
        aSchedule.overdueCount * 80 +
        a.stats.dueThisWeek * 35 +
        aSchedule.upcoming7Count * 35 +
        a.stats.openActions * 25 +
        (aFavorite ? 5 : 0) -
        (a.archived ? 1000 : 0);
      const bPriority =
        b.stats.overdueActions * 80 +
        bSchedule.overdueCount * 80 +
        b.stats.dueThisWeek * 35 +
        bSchedule.upcoming7Count * 35 +
        b.stats.openActions * 25 +
        (bFavorite ? 5 : 0) -
        (b.archived ? 1000 : 0);

      if (bPriority !== aPriority) return bPriority - aPriority;
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      if (aFavorite !== bFavorite) return aFavorite ? -1 : 1;

      return a.project.localeCompare(b.project);
    });

  const renderProject = ({ item }: { item: typeof projectRows[number] }) => {
    const favorite = favoriteProjects.some(
      project => project.toLowerCase() === item.project.toLowerCase(),
    );
    const scheduleSummary = buildScheduleSummary(scheduleItems, {
      projectName: item.project,
    });
    const runtime = buildRuntime({
      projectName: item.project,
      projectNames: [...activeProjects, ...archivedProjects],
      updates: savedUpdates,
      scheduleItems,
      projectAreas,
      surface: 'projects',
    });

    return (
      <ProjectFinderRow
        project={item.project}
        stats={item.stats}
        scheduleSummary={scheduleSummary}
        runtime={runtime}
        archived={item.archived}
        favorite={favorite}
        onPress={() => onSelect(item.project)}
        onUpdate={() => onUpdateProject?.(item.project)}
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
            subtitle="PIE-ranked work. Open the project that needs attention, or start the update PIE recommends."
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
              {(['Active', 'Favorites', 'Archived'] as const).map(filter => {
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
          </View>

          <AddProjectCard
            buttonLabel="Add Project"
            placeholder="New project name"
            onAdd={onAddProject}
          />

          <Text style={styles.sectionLabel}>
            PIE-ranked project cards
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
