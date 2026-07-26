import type {
  PIERealityConflict,
  PIERealityHistoryEvent,
  PIERealityModel,
  PIERealityObject,
  PIERealityUncertaintyRecord,
} from './PIERealityModel';
import {
  appendRealityObjectHistory,
  getRealityConflicts,
  getRealityModelSnapshots,
  getRealityObjectHistory,
  getRealityUncertainties,
  loadCurrentRealityModel,
  queryRealityObjects,
  saveSynchronizedRealityModel,
  type PIERealityModelSnapshot,
  type PIERealityObjectQuery,
} from './PIERealityModelStorage';
import {
  loadPIERealityModelCloud,
  savePIERealityModelCloud,
} from './SupabaseService';

export type PIERealityModelRepository = {
  loadCurrent(organizationId: string, projectId: string): Promise<PIERealityModel | null>;
  saveSynchronized(model: PIERealityModel, reason?: string): Promise<PIERealityModel>;
  /**
   * True only after this repository instance has completed a cloud read or
   * write successfully. Missing implementations are treated as unverified.
   */
  hasFreshCloudAuthority?(): boolean;
  appendObjectHistory(
    organizationId: string,
    projectId: string,
    objectId: string,
    event: PIERealityHistoryEvent,
  ): Promise<PIERealityModel | null>;
  getObjectHistory(
    organizationId: string,
    projectId: string,
    objectId: string,
  ): Promise<PIERealityHistoryEvent[]>;
  getSnapshots(organizationId: string, projectId: string): Promise<PIERealityModelSnapshot[]>;
  getConflicts(organizationId: string, projectId: string): Promise<PIERealityConflict[]>;
  getUncertainties(organizationId: string, projectId: string): Promise<PIERealityUncertaintyRecord[]>;
  queryObjects(
    organizationId: string,
    projectId: string,
    query: PIERealityObjectQuery,
  ): Promise<PIERealityObject[]>;
};

export const localPIERealityModelRepository: PIERealityModelRepository = {
  loadCurrent: loadCurrentRealityModel,
  async saveSynchronized(model, reason) {
    const state = await saveSynchronizedRealityModel(model, reason);
    return state.currentModel || model;
  },
  appendObjectHistory: appendRealityObjectHistory,
  getObjectHistory: getRealityObjectHistory,
  getSnapshots: getRealityModelSnapshots,
  getConflicts: getRealityConflicts,
  getUncertainties: getRealityUncertainties,
  queryObjects: queryRealityObjects,
};

export function createPIERealityModelRepository(input: {
  cloudEnabled?: boolean;
  identityTrusted?: boolean;
} = {}): PIERealityModelRepository {
  const useCloud = Boolean(input.cloudEnabled && input.identityTrusted);

  if (!useCloud) return localPIERealityModelRepository;
  let freshCloudAuthority = false;

  return {
    async loadCurrent(organizationId, projectId) {
      const cloudResult = await loadPIERealityModelCloud(organizationId, projectId);
      if (cloudResult.ok && cloudResult.data) {
        freshCloudAuthority = true;
        return cloudResult.data;
      }
      freshCloudAuthority = false;
      return localPIERealityModelRepository.loadCurrent(organizationId, projectId);
    },
    async saveSynchronized(model, reason) {
      const localModel = await localPIERealityModelRepository.saveSynchronized(model, reason);
      const cloudResult = await savePIERealityModelCloud(localModel, reason);
      freshCloudAuthority = cloudResult.ok;
      if (!cloudResult.ok && cloudResult.configured) {
        throw new Error(cloudResult.error || cloudResult.message || 'Reality Model cloud persistence failed.');
      }
      return cloudResult.data || localModel;
    },
    hasFreshCloudAuthority() {
      return freshCloudAuthority;
    },
    appendObjectHistory: localPIERealityModelRepository.appendObjectHistory,
    getObjectHistory: localPIERealityModelRepository.getObjectHistory,
    getSnapshots: localPIERealityModelRepository.getSnapshots,
    getConflicts: localPIERealityModelRepository.getConflicts,
    getUncertainties: localPIERealityModelRepository.getUncertainties,
    queryObjects: localPIERealityModelRepository.queryObjects,
  };
}
