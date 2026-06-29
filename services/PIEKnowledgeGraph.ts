import type {
  ContactBook,
  ProjectArea,
  ProjectContact,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import type {
  ProjectConfidenceLevel,
  ProjectIntelligenceSummary,
  ProjectReportHistoryMetadata,
} from './ProjectIntelligenceEngine';
import type {
  PIEDecision,
  PIEDecisionPriority,
  PIEDecisionQueue,
} from './PIEDecisionEngine';
import type { PIEMemorySnapshot } from './PIEMemoryEngine';
import type {
  PIEConcern,
  PIEEvidence,
  PIEQuestion,
  PIEReasoningResult,
  PIEThoughtRecommendation,
} from './PIEReasoningEngine';
import type {
  PIERecommendation,
  PIERuntimeState,
  PIEUnknown,
} from './PIERuntime';
import type { ProjectEvent } from './ProjectEventService';

export type PIEGraphNodeType =
  | 'project'
  | 'area'
  | 'photo'
  | 'update'
  | 'schedule_item'
  | 'document'
  | 'report'
  | 'person'
  | 'contractor'
  | 'issue'
  | 'safety'
  | 'inspection'
  | 'decision'
  | 'recommendation'
  | 'unknown'
  | 'event'
  | 'evidence';

export type PIEGraphEdgeType =
  | 'belongs_to'
  | 'located_in'
  | 'supports'
  | 'contradicts'
  | 'blocks'
  | 'depends_on'
  | 'mentions'
  | 'assigned_to'
  | 'caused_by'
  | 'resolved_by'
  | 'requires_approval'
  | 'needs_evidence'
  | 'feeds_report'
  | 'updates_story';

export type PIEGraphSource =
  | 'project-event'
  | 'project-intelligence'
  | 'pie-reasoning'
  | 'pie-memory'
  | 'pie-decision'
  | 'pie-runtime'
  | 'project-update'
  | 'photo'
  | 'schedule'
  | 'document'
  | 'report-history'
  | 'project-area'
  | 'contact'
  | 'knowledge-graph';

export type PIEGraphNode = {
  id: string;
  type: PIEGraphNodeType;
  projectName: string;
  label: string;
  summary: string;
  source: PIEGraphSource;
  confidence: ProjectConfidenceLevel;
  occurredAt: string | null;
  relatedRecordId: string | null;
  metadata: Record<string, unknown>;
};

export type PIEGraphEdge = {
  id: string;
  type: PIEGraphEdgeType;
  fromNodeId: string;
  toNodeId: string;
  projectName: string;
  label: string;
  summary: string;
  source: PIEGraphSource;
  confidence: ProjectConfidenceLevel;
  evidence: string[];
  metadata: Record<string, unknown>;
};

export type PIEGraphRelationship = {
  id: string;
  projectName: string;
  edgeType: PIEGraphEdgeType;
  fromNode: PIEGraphNode;
  toNode: PIEGraphNode;
  edge: PIEGraphEdge;
  summary: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEGraphInsight = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  confidence: ProjectConfidenceLevel;
  priority: PIEDecisionPriority;
  nodeIds: string[];
  edgeIds: string[];
  relationshipIds: string[];
  suggestedNextAction: string;
};

export type PIEGraphGap = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  missingNodeType: PIEGraphNodeType | null;
  severity: PIEDecisionPriority;
  confidence: ProjectConfidenceLevel;
  relatedNodeIds: string[];
  suggestedAction: string;
};

export type PIEGraph = {
  id: string;
  projectName: string;
  generatedAt: string;
  nodes: PIEGraphNode[];
  edges: PIEGraphEdge[];
  relationships: PIEGraphRelationship[];
  insights: PIEGraphInsight[];
  gaps: PIEGraphGap[];
  sourceCounts: Record<PIEGraphNodeType, number>;
};

export type BuildPIEKnowledgeGraphParams = {
  projectName?: string | null;
  projectNames?: string[];
  projectEvents?: ProjectEvent[];
  intelligence?: ProjectIntelligenceSummary | null;
  reasoning?: PIEReasoningResult | null;
  memory?: PIEMemorySnapshot | null;
  decisionQueue?: PIEDecisionQueue | null;
  runtime?: PIERuntimeState | null;
  updates?: ProjectUpdate[];
  photos?: UpdatePhoto[];
  scheduleItems?: ScheduleItem[];
  referenceDocuments?: ReferenceDocument[];
  reportHistory?: ProjectReportHistoryMetadata[];
  projectAreas?: ProjectArea[];
  contacts?: ContactBook | ProjectContact[];
  now?: Date;
};

export type FindRelatedNodesOptions = {
  edgeTypes?: PIEGraphEdgeType[];
  nodeTypes?: PIEGraphNodeType[];
  direction?: 'incoming' | 'outgoing' | 'both';
  maxDepth?: number;
};

type GraphInput = PIEGraph | BuildPIEKnowledgeGraphParams;

type GraphBuildParts = Required<
  Pick<
    BuildPIEKnowledgeGraphParams,
    | 'projectEvents'
    | 'updates'
    | 'photos'
    | 'scheduleItems'
    | 'referenceDocuments'
    | 'reportHistory'
    | 'projectAreas'
  >
> & {
  projectName: string;
  projectNames: string[];
  generatedAt: string;
  intelligence: ProjectIntelligenceSummary | null;
  reasoning: PIEReasoningResult | null;
  memory: PIEMemorySnapshot | null;
  decisionQueue: PIEDecisionQueue | null;
  runtime: PIERuntimeState | null;
  contacts: ProjectContact[];
};

type GraphBuilder = {
  projectName: string;
  generatedAt: string;
  nodes: Map<string, PIEGraphNode>;
  edges: Map<string, PIEGraphEdge>;
};

const EVIDENCE_NODE_TYPES: PIEGraphNodeType[] = [
  'photo',
  'update',
  'schedule_item',
  'document',
  'report',
  'event',
  'evidence',
  'decision',
];

export function buildPIEKnowledgeGraph(
  params: BuildPIEKnowledgeGraphParams = {},
): PIEGraph {
  const parts = normalizeBuildParts(params);
  const builder: GraphBuilder = {
    projectName: parts.projectName,
    generatedAt: parts.generatedAt,
    nodes: new Map(),
    edges: new Map(),
  };
  const projectNode = addNode(builder, {
    id: projectNodeId(parts.projectName),
    type: 'project',
    projectName: parts.projectName,
    label: parts.projectName,
    summary: 'Project root for PIE Knowledge Graph.',
    source: 'knowledge-graph',
    confidence: 'high',
    occurredAt: parts.generatedAt,
    relatedRecordId: null,
    metadata: {
      projectNames: parts.projectNames,
    },
  });

  addAreaNodes(builder, parts, projectNode.id);
  addContactNodes(builder, parts, projectNode.id);
  addUpdateNodes(builder, parts, projectNode.id);
  addScheduleNodes(builder, parts, projectNode.id);
  addDocumentNodes(builder, parts, projectNode.id);
  addReportNodes(builder, parts, projectNode.id);
  addEventNodes(builder, parts, projectNode.id);
  addReasoningNodes(builder, parts, projectNode.id);
  addDecisionNodes(builder, parts, projectNode.id);
  addRuntimeNodes(builder, parts, projectNode.id);
  addMemoryEdges(builder, parts, projectNode.id);

  const nodes = Array.from(builder.nodes.values());
  const edges = Array.from(builder.edges.values());
  const relationships = buildRelationships(parts.projectName, nodes, edges);
  const gaps = buildGraphGapsFromParts(parts, nodes, edges);
  const insights = buildGraphInsightsFromParts(
    parts,
    nodes,
    edges,
    relationships,
    gaps,
  );

  return {
    id: `pie-graph:${slug(parts.projectName)}:${parts.generatedAt}`,
    projectName: parts.projectName,
    generatedAt: parts.generatedAt,
    nodes,
    edges,
    relationships,
    insights,
    gaps,
    sourceCounts: countNodesByType(nodes),
  };
}

export function getProjectGraph(
  input: GraphInput = {},
  projectName?: string | null,
): PIEGraph {
  const graph = normalizeGraph(input);

  if (!projectName || graph.projectName === projectName) return graph;

  const nodeIds = new Set(
    graph.nodes
      .filter(node => node.projectName === projectName || node.type === 'project')
      .map(node => node.id),
  );
  const edges = graph.edges.filter(
    edge => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId),
  );
  const nodes = graph.nodes.filter(node => nodeIds.has(node.id));
  const relationships = buildRelationships(projectName, nodes, edges);

  return {
    ...graph,
    id: `pie-graph:${slug(projectName)}:${graph.generatedAt}`,
    projectName,
    nodes,
    edges,
    relationships,
    insights: graph.insights.filter(insight => insight.projectName === projectName),
    gaps: graph.gaps.filter(gap => gap.projectName === projectName),
    sourceCounts: countNodesByType(nodes),
  };
}

export function getConnectedEvidence(
  input: GraphInput,
  nodeId: string,
): PIEGraphNode[] {
  const graph = normalizeGraph(input);

  return findRelatedNodes(graph, nodeId, {
    nodeTypes: EVIDENCE_NODE_TYPES,
    direction: 'both',
    maxDepth: 2,
  });
}

export function getBlockedItems(input: GraphInput): PIEGraphRelationship[] {
  const graph = normalizeGraph(input);

  return graph.relationships.filter(
    relationship => relationship.edgeType === 'blocks',
  );
}

export function getEvidenceForRecommendation(
  input: GraphInput,
  recommendationId: string,
): PIEGraphNode[] {
  const graph = normalizeGraph(input);
  const recommendation =
    graph.nodes.find(node => node.id === recommendationId) ||
    graph.nodes.find(
      node =>
        node.type === 'recommendation' &&
        (node.relatedRecordId === recommendationId ||
          normalizedKey(node.label) === normalizedKey(recommendationId)),
    );

  if (!recommendation) return [];

  return findRelatedNodes(graph, recommendation.id, {
    edgeTypes: ['supports', 'depends_on', 'needs_evidence'],
    nodeTypes: EVIDENCE_NODE_TYPES,
    direction: 'incoming',
    maxDepth: 2,
  });
}

export function getGraphGaps(input: GraphInput): PIEGraphGap[] {
  return normalizeGraph(input).gaps;
}

export function getGraphInsights(input: GraphInput): PIEGraphInsight[] {
  return normalizeGraph(input).insights;
}

export function findRelatedNodes(
  input: GraphInput,
  nodeId: string,
  options: FindRelatedNodesOptions = {},
): PIEGraphNode[] {
  const graph = normalizeGraph(input);
  const direction = options.direction ?? 'both';
  const maxDepth = Math.max(1, options.maxDepth ?? 1);
  const allowedEdges = new Set(options.edgeTypes ?? []);
  const allowedNodes = new Set(options.nodeTypes ?? []);
  const visited = new Set<string>([nodeId]);
  const results = new Map<string, PIEGraphNode>();
  let frontier = [nodeId];

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const nextFrontier: string[] = [];

    frontier.forEach(currentId => {
      graph.edges.forEach(edge => {
        if (allowedEdges.size > 0 && !allowedEdges.has(edge.type)) return;

        const outgoing = edge.fromNodeId === currentId;
        const incoming = edge.toNodeId === currentId;
        if (direction === 'outgoing' && !outgoing) return;
        if (direction === 'incoming' && !incoming) return;
        if (direction === 'both' && !outgoing && !incoming) return;

        const relatedId = outgoing ? edge.toNodeId : edge.fromNodeId;
        if (visited.has(relatedId)) return;

        const relatedNode = graph.nodes.find(node => node.id === relatedId);
        if (!relatedNode) return;

        visited.add(relatedId);
        nextFrontier.push(relatedId);

        if (allowedNodes.size === 0 || allowedNodes.has(relatedNode.type)) {
          results.set(relatedNode.id, relatedNode);
        }
      });
    });

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  return Array.from(results.values());
}

function normalizeBuildParts(
  params: BuildPIEKnowledgeGraphParams,
): GraphBuildParts {
  const runtime = params.runtime ?? null;
  const intelligence = params.intelligence ?? runtime?.intelligence ?? null;
  const reasoning = params.reasoning ?? runtime?.reasoning ?? null;
  const memory = params.memory ?? runtime?.memory ?? null;
  const decisionQueue = params.decisionQueue ?? runtime?.decisionQueue ?? null;
  const projectName =
    params.projectName?.trim() ||
    runtime?.projectName ||
    intelligence?.projectName ||
    reasoning?.projectName ||
    memory?.projectName ||
    decisionQueue?.projectName ||
    params.projectNames?.[0] ||
    'Unassigned Project';
  const projectEvents = uniqueById([
    ...(params.projectEvents ?? []),
    ...(runtime?.projectEvents ?? []),
  ]);

  return {
    projectName,
    projectNames: uniqueText([
      projectName,
      ...(params.projectNames ?? []),
      ...(runtime?.projectNames ?? []),
    ]),
    generatedAt:
      runtime?.generatedAt ||
      intelligence?.generatedAt ||
      reasoning?.generatedAt ||
      memory?.generatedAt ||
      decisionQueue?.generatedAt ||
      (params.now ?? new Date()).toISOString(),
    projectEvents,
    intelligence,
    reasoning,
    memory,
    decisionQueue,
    runtime,
    updates: filterUpdatesForProject(params.updates ?? [], projectName),
    photos: params.photos ?? [],
    scheduleItems: filterScheduleForProject(params.scheduleItems ?? [], projectName),
    referenceDocuments: params.referenceDocuments ?? [],
    reportHistory: filterReportsForProject(params.reportHistory ?? [], projectName),
    projectAreas: params.projectAreas ?? [],
    contacts: contactList(params.contacts),
  };
}

function addAreaNodes(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  projectNodeIdValue: string,
) {
  const areaCandidates = [
    ...parts.projectAreas.map(area => ({
      id: area.id,
      name: area.name,
      building: area.building,
      source: 'project-area' as const,
      metadata: area as unknown as Record<string, unknown>,
    })),
    ...parts.updates
      .filter(update => update.selectedAreaName)
      .map(update => ({
        id: update.selectedAreaId || update.selectedAreaName || '',
        name: update.selectedAreaName || '',
        building: null,
        source: 'project-update' as const,
        metadata: {
          updateId: update.id,
        },
      })),
    ...parts.photos
      .filter(photo => photo.selectedAreaName)
      .map(photo => ({
        id: photo.selectedAreaId || photo.selectedAreaName || '',
        name: photo.selectedAreaName || '',
        building: null,
        source: 'photo' as const,
        metadata: {
          photoId: photo.id,
        },
      })),
    ...parts.projectEvents
      .filter(event => event.relatedArea?.name)
      .map(event => ({
        id: event.relatedArea?.id || event.relatedArea?.name || '',
        name: event.relatedArea?.name || '',
        building: event.relatedArea?.building,
        source: 'project-event' as const,
        metadata: {
          eventId: event.id,
        },
      })),
    ...parts.scheduleItems
      .filter(item => item.locationName)
      .map(item => ({
        id: item.locationName,
        name: item.locationName,
        building: null,
        source: 'schedule' as const,
        metadata: {
          scheduleItemId: item.id,
        },
      })),
  ];

  areaCandidates.forEach(area => {
    const node = addNode(builder, {
      id: areaNodeId(parts.projectName, area.id || area.name),
      type: 'area',
      projectName: parts.projectName,
      label: area.name,
      summary: area.building
        ? `${area.name} in ${area.building}.`
        : `Project area ${area.name}.`,
      source: area.source,
      confidence: area.source === 'project-area' ? 'high' : 'medium',
      occurredAt: parts.generatedAt,
      relatedRecordId: area.id || area.name,
      metadata: area.metadata,
    });

    addEdge(builder, {
      type: 'belongs_to',
      fromNodeId: node.id,
      toNodeId: projectNodeIdValue,
      label: 'Area belongs to project',
      summary: `${node.label} belongs to ${parts.projectName}.`,
      source: area.source,
      confidence: node.confidence,
      evidence: [node.summary],
      metadata: {},
    });
  });
}

function addContactNodes(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  projectNodeIdValue: string,
) {
  parts.contacts.forEach(contact => {
    const node = addNode(builder, {
      id: personNodeId(parts.projectName, contact.id || contact.name),
      type: 'person',
      projectName: parts.projectName,
      label: contact.name,
      summary: contact.email || contact.phone
        ? `${contact.name} has contact information available.`
        : `${contact.name} is listed as a project contact.`,
      source: 'contact',
      confidence: 'medium',
      occurredAt: parts.generatedAt,
      relatedRecordId: contact.id,
      metadata: contact as unknown as Record<string, unknown>,
    });

    addEdge(builder, {
      type: 'mentions',
      fromNodeId: projectNodeIdValue,
      toNodeId: node.id,
      label: 'Project contact',
      summary: `${parts.projectName} mentions ${contact.name}.`,
      source: 'contact',
      confidence: 'medium',
      evidence: [node.summary],
      metadata: {},
    });
  });
}

function addUpdateNodes(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  projectNodeIdValue: string,
) {
  const updates = parts.updates;
  const explicitPhotos = parts.photos;

  updates.forEach(update => {
    const updateNode = addNode(builder, {
      id: updateNodeId(update.id),
      type: 'update',
      projectName: update.projectName || parts.projectName,
      label: `Update ${formatDateLabel(update.date)}`,
      summary: update.notes || 'Project update with no typed notes.',
      source: 'project-update',
      confidence: update.notes || update.photos.length > 0 ? 'high' : 'medium',
      occurredAt: update.date || null,
      relatedRecordId: update.id,
      metadata: {
        selectedAreaId: update.selectedAreaId ?? null,
        selectedAreaName: update.selectedAreaName ?? null,
        recipientContactIds: update.recipients.contactIds,
      },
    });

    addEdge(builder, {
      type: 'belongs_to',
      fromNodeId: updateNode.id,
      toNodeId: projectNodeIdValue,
      label: 'Update belongs to project',
      summary: `${updateNode.label} belongs to ${parts.projectName}.`,
      source: 'project-update',
      confidence: updateNode.confidence,
      evidence: [updateNode.summary],
      metadata: {},
    });
    connectAreaByName(builder, parts, updateNode.id, update.selectedAreaName, 'project-update');
    connectRecipients(builder, parts, updateNode.id, update.recipients.contactIds);

    update.photos.forEach(photo => {
      addPhotoNode(builder, parts, photo, updateNode.id, projectNodeIdValue);
    });
  });

  explicitPhotos.forEach(photo => {
    if (builder.nodes.has(photoNodeId(photo.id))) return;
    addPhotoNode(builder, parts, photo, null, projectNodeIdValue);
  });
}

function addPhotoNode(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  photo: UpdatePhoto,
  updateNodeIdValue: string | null,
  projectNodeIdValue: string,
) {
  const photoNode = addNode(builder, {
    id: photoNodeId(photo.id),
    type: 'photo',
    projectName: parts.projectName,
    label: photo.caption || photo.fileName || 'Project Photo',
    summary: photoSummary(photo),
    source: 'photo',
    confidence: photo.caption || photo.actionRequired ? 'high' : 'medium',
    occurredAt: photo.locationCapturedAt ?? null,
    relatedRecordId: photo.id,
    metadata: photo as unknown as Record<string, unknown>,
  });

  addEdge(builder, {
    type: updateNodeIdValue ? 'supports' : 'belongs_to',
    fromNodeId: photoNode.id,
    toNodeId: updateNodeIdValue ?? projectNodeIdValue,
    label: updateNodeIdValue ? 'Photo supports update' : 'Photo belongs to project',
    summary: updateNodeIdValue
      ? `${photoNode.label} supports the field update.`
      : `${photoNode.label} belongs to ${parts.projectName}.`,
    source: 'photo',
    confidence: photoNode.confidence,
    evidence: [photoNode.summary],
    metadata: {},
  });
  connectAreaByName(builder, parts, photoNode.id, photo.selectedAreaName, 'photo');

  if (photo.category === 'Open Issue' || photo.actionRequired) {
    const issueNode = addIssueLikeNode(builder, parts, {
      type: photo.category === 'Safety Concern' ? 'safety' : 'issue',
      id: `photo-issue-${photo.id}`,
      label: photo.actionRequired || photo.caption || 'Photo Action',
      summary: photo.actionRequired || photo.caption || 'Photo indicates action is required.',
      source: 'photo',
      confidence: photo.actionRequired ? 'high' : 'medium',
      relatedRecordId: photo.id,
      occurredAt: photo.locationCapturedAt ?? null,
      metadata: {
        photoId: photo.id,
        actionStatus: photo.actionStatus,
        actionDueDate: photo.actionDueDate,
      },
    });

    addEdge(builder, {
      type: 'supports',
      fromNodeId: photoNode.id,
      toNodeId: issueNode.id,
      label: 'Photo supports issue',
      summary: `${photoNode.label} supports ${issueNode.label}.`,
      source: 'photo',
      confidence: issueNode.confidence,
      evidence: [photoNode.summary],
      metadata: {},
    });

    if (photo.actionOwner) {
      const ownerNode = contractorOrPersonNode(
        builder,
        parts,
        photo.actionOwner,
        'photo',
      );
      addEdge(builder, {
        type: 'assigned_to',
        fromNodeId: issueNode.id,
        toNodeId: ownerNode.id,
        label: 'Action assigned',
        summary: `${issueNode.label} is assigned to ${ownerNode.label}.`,
        source: 'photo',
        confidence: 'medium',
        evidence: [photo.actionRequired || photo.caption],
        metadata: {
          dueDate: photo.actionDueDate,
          status: photo.actionStatus,
        },
      });
    }

    if (photo.actionStatus === 'Closed') {
      addEdge(builder, {
        type: 'resolved_by',
        fromNodeId: issueNode.id,
        toNodeId: photoNode.id,
        label: 'Issue closed by photo action',
        summary: `${issueNode.label} is marked closed in photo action status.`,
        source: 'photo',
        confidence: 'medium',
        evidence: [photo.actionStatus],
        metadata: {},
      });
    }
  }
}

function addScheduleNodes(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  projectNodeIdValue: string,
) {
  parts.scheduleItems.forEach(item => {
    const scheduleNode = addNode(builder, {
      id: scheduleNodeId(item.id),
      type: 'schedule_item',
      projectName: item.projectName || parts.projectName,
      label: item.taskName,
      summary: scheduleSummary(item),
      source: 'schedule',
      confidence: 'high',
      occurredAt: item.finishDate || item.createdAt || null,
      relatedRecordId: item.id,
      metadata: item as unknown as Record<string, unknown>,
    });

    addEdge(builder, {
      type: 'belongs_to',
      fromNodeId: scheduleNode.id,
      toNodeId: projectNodeIdValue,
      label: 'Schedule item belongs to project',
      summary: `${item.taskName} belongs to ${parts.projectName}.`,
      source: 'schedule',
      confidence: 'high',
      evidence: [scheduleNode.summary],
      metadata: {},
    });
    connectAreaByName(builder, parts, scheduleNode.id, item.locationName, 'schedule');

    if (item.owner) {
      const ownerNode = contractorOrPersonNode(builder, parts, item.owner, 'schedule');
      addEdge(builder, {
        type: 'assigned_to',
        fromNodeId: scheduleNode.id,
        toNodeId: ownerNode.id,
        label: 'Schedule owner',
        summary: `${item.taskName} is assigned to ${item.owner}.`,
        source: 'schedule',
        confidence: 'medium',
        evidence: [item.owner],
        metadata: {},
      });
    }

    if (item.contractor) {
      const contractorNode = addNode(builder, {
        id: contractorNodeId(parts.projectName, item.contractor),
        type: 'contractor',
        projectName: parts.projectName,
        label: item.contractor,
        summary: `${item.contractor} is tied to schedule item ${item.taskName}.`,
        source: 'schedule',
        confidence: 'medium',
        occurredAt: item.createdAt || null,
        relatedRecordId: item.id,
        metadata: {
          scheduleItemId: item.id,
        },
      });
      addEdge(builder, {
        type: 'assigned_to',
        fromNodeId: scheduleNode.id,
        toNodeId: contractorNode.id,
        label: 'Schedule contractor',
        summary: `${item.taskName} is tied to contractor ${item.contractor}.`,
        source: 'schedule',
        confidence: 'medium',
        evidence: [item.contractor],
        metadata: {},
      });
    }

    if (isScheduleBlocked(item)) {
      const issueNode = addIssueLikeNode(builder, parts, {
        type: 'issue',
        id: `schedule-blocker-${item.id}`,
        label: `${item.taskName} needs attention`,
        summary:
          item.status === 'Waiting'
            ? `${item.taskName} is waiting. ${item.notes || ''}`.trim()
            : `${item.taskName} may be overdue or blocked.`,
        source: 'schedule',
        confidence: 'medium',
        relatedRecordId: item.id,
        occurredAt: item.finishDate || item.createdAt || null,
        metadata: {
          scheduleItemId: item.id,
          status: item.status,
          priority: item.priority,
        },
      });

      addEdge(builder, {
        type: 'blocks',
        fromNodeId: issueNode.id,
        toNodeId: scheduleNode.id,
        label: 'Issue blocks schedule',
        summary: `${issueNode.label} blocks or delays ${item.taskName}.`,
        source: 'schedule',
        confidence: 'medium',
        evidence: [scheduleNode.summary],
        metadata: {},
      });
    }
  });
}

function addDocumentNodes(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  projectNodeIdValue: string,
) {
  parts.referenceDocuments.forEach(document => {
    const documentNode = addNode(builder, {
      id: documentNodeId(document.id),
      type: 'document',
      projectName: parts.projectName,
      label: document.name,
      summary: document.notes || `${document.category} document metadata.`,
      source: 'document',
      confidence: document.isCurrent ? 'high' : 'medium',
      occurredAt: document.importedAt,
      relatedRecordId: document.id,
      metadata: document as unknown as Record<string, unknown>,
    });

    addEdge(builder, {
      type: 'belongs_to',
      fromNodeId: documentNode.id,
      toNodeId: projectNodeIdValue,
      label: 'Document belongs to project context',
      summary: `${document.name} is available as project document metadata.`,
      source: 'document',
      confidence: documentNode.confidence,
      evidence: [documentNode.summary],
      metadata: {},
    });

    connectAreaByText(
      builder,
      parts,
      documentNode.id,
      `${document.name} ${document.category} ${document.notes}`,
      'document',
    );
  });
}

function addReportNodes(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  projectNodeIdValue: string,
) {
  parts.reportHistory.forEach((report, index) => {
    const reportId = report.id || `${report.reportType || 'report'}-${index}`;
    const reportNode = addNode(builder, {
      id: reportNodeId(reportId),
      type: 'report',
      projectName: report.projectName || parts.projectName,
      label: report.title || report.reportType || 'Project Report',
      summary: `${report.reportType || 'Report'} generated from ${report.source || 'report history'}.`,
      source: 'report-history',
      confidence: 'medium',
      occurredAt: report.generatedAt ?? null,
      relatedRecordId: reportId,
      metadata: report as unknown as Record<string, unknown>,
    });

    addEdge(builder, {
      type: 'belongs_to',
      fromNodeId: reportNode.id,
      toNodeId: projectNodeIdValue,
      label: 'Report belongs to project',
      summary: `${reportNode.label} belongs to ${parts.projectName}.`,
      source: 'report-history',
      confidence: 'medium',
      evidence: [reportNode.summary],
      metadata: {},
    });
    addEdge(builder, {
      type: 'feeds_report',
      fromNodeId: projectNodeIdValue,
      toNodeId: reportNode.id,
      label: 'Project feeds report',
      summary: `${parts.projectName} context feeds ${reportNode.label}.`,
      source: 'report-history',
      confidence: 'medium',
      evidence: [reportNode.summary],
      metadata: {},
    });
  });
}

function addEventNodes(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  projectNodeIdValue: string,
) {
  parts.projectEvents.forEach(event => {
    const eventNode = addNode(builder, {
      id: eventNodeId(event.id),
      type: eventTypeToNodeType(event),
      projectName: event.projectName || parts.projectName,
      label: event.title,
      summary: event.description,
      source: 'project-event',
      confidence: event.confidence,
      occurredAt: event.occurredAt,
      relatedRecordId: event.id,
      metadata: {
        eventType: event.eventType,
        source: event.source,
        ...event.metadata,
      },
    });

    addEdge(builder, {
      type: 'updates_story',
      fromNodeId: eventNode.id,
      toNodeId: projectNodeIdValue,
      label: 'Event updates project story',
      summary: `${event.title} updates the project story.`,
      source: 'project-event',
      confidence: event.confidence,
      evidence: [event.description],
      metadata: {
        eventType: event.eventType,
      },
    });

    if (event.relatedArea?.name) {
      connectAreaByName(
        builder,
        parts,
        eventNode.id,
        event.relatedArea.name,
        'project-event',
      );
    }

    event.relatedPeople.forEach(person => {
      const personNode = contractorOrPersonNode(
        builder,
        parts,
        person.name,
        'project-event',
      );
      addEdge(builder, {
        type: 'mentions',
        fromNodeId: eventNode.id,
        toNodeId: personNode.id,
        label: 'Event mentions person',
        summary: `${event.title} mentions ${person.name}.`,
        source: 'project-event',
        confidence: event.confidence,
        evidence: [event.description],
        metadata: person as unknown as Record<string, unknown>,
      });
    });

    event.relatedDocuments.forEach(document => {
      const documentNode = addNode(builder, {
        id: documentNodeId(document.id || document.name),
        type: 'document',
        projectName: parts.projectName,
        label: document.name,
        summary: document.category
          ? `${document.category} document mentioned by event.`
          : 'Document mentioned by event.',
        source: 'project-event',
        confidence: event.confidence,
        occurredAt: event.occurredAt,
        relatedRecordId: document.id ?? null,
        metadata: document as unknown as Record<string, unknown>,
      });
      addEdge(builder, {
        type: 'mentions',
        fromNodeId: eventNode.id,
        toNodeId: documentNode.id,
        label: 'Event mentions document',
        summary: `${event.title} mentions ${document.name}.`,
        source: 'project-event',
        confidence: event.confidence,
        evidence: [event.description],
        metadata: {},
      });
    });
  });
}

function addReasoningNodes(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  projectNodeIdValue: string,
) {
  const reasoning = parts.reasoning;
  if (!reasoning) return;

  const evidenceNodes = reasoning.evidence.map(evidence => {
    const node = addNode(builder, {
      id: evidenceNodeId(evidence.id),
      type: 'evidence',
      projectName: evidence.projectName || parts.projectName,
      label: evidence.title,
      summary: evidence.detail,
      source: 'pie-reasoning',
      confidence: evidence.confidence,
      occurredAt: evidence.occurredAt,
      relatedRecordId: evidence.relatedRecordId,
      metadata: {
        reasoningSource: evidence.source,
        relatedEventId: evidence.relatedEventId,
        ...evidence.metadata,
      },
    });

    addEdge(builder, {
      type: 'supports',
      fromNodeId: node.id,
      toNodeId: projectNodeIdValue,
      label: 'Evidence supports project understanding',
      summary: `${evidence.title} supports PIE's understanding of ${parts.projectName}.`,
      source: 'pie-reasoning',
      confidence: evidence.confidence,
      evidence: [evidence.detail],
      metadata: {
        evidenceId: evidence.id,
      },
    });

    return node;
  });

  reasoning.concerns.forEach(concern => {
    const issueNode = addConcernNode(builder, parts, concern);
    connectEvidenceIds(
      builder,
      issueNode.id,
      concern.evidenceIds,
      evidenceNodes,
      'supports',
      concern.summary,
      concern.confidence,
    );
  });

  reasoning.questions.forEach(question => {
    const unknownNode = addUnknownNode(builder, parts, {
      id: `question-${question.id}`,
      label: question.question,
      summary: question.reason,
      source: 'pie-reasoning',
      confidence: question.confidence,
      relatedRecordId: question.id,
      occurredAt: question.createdAt,
      metadata: question.metadata,
    });
    connectEvidenceIds(
      builder,
      unknownNode.id,
      question.evidenceIds,
      evidenceNodes,
      'needs_evidence',
      question.reason,
      question.confidence,
    );
  });

  reasoning.recommendations.forEach(recommendation => {
    addReasoningRecommendation(builder, parts, recommendation, evidenceNodes);
  });
}

function addDecisionNodes(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  projectNodeIdValue: string,
) {
  const queue = parts.decisionQueue;
  if (!queue) return;

  queue.decisions.forEach(decision => {
    addDecisionNode(builder, parts, decision, projectNodeIdValue);
  });
}

function addRuntimeNodes(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  projectNodeIdValue: string,
) {
  const runtime = parts.runtime;
  if (!runtime) return;

  runtime.recommendations.forEach(recommendation => {
    const node = addRecommendationNode(builder, parts, {
      id: `runtime-${recommendation.id}`,
      label: recommendation.title,
      summary: recommendation.summary,
      source: 'pie-runtime',
      confidence: recommendation.confidence,
      relatedRecordId: recommendation.id,
      occurredAt: runtime.generatedAt,
      metadata: {
        priority: recommendation.priority,
        impact: recommendation.impact,
        suggestedNextAction: recommendation.suggestedNextAction,
        requiresApproval: recommendation.requiresApproval,
      },
    });
    connectRecommendationEvidence(
      builder,
      parts,
      node.id,
      recommendation,
      projectNodeIdValue,
    );
  });

  runtime.unknowns.forEach(unknown => {
    const node = addUnknownNode(builder, parts, {
      id: `runtime-${unknown.id}`,
      label: unknown.title,
      summary: unknown.summary,
      source: 'pie-runtime',
      confidence: unknown.confidence,
      relatedRecordId: unknown.id,
      occurredAt: runtime.generatedAt,
      metadata: {
        priority: unknown.priority,
        impact: unknown.impact,
        suggestedAction: unknown.suggestedAction,
      },
    });
    addEdge(builder, {
      type: 'needs_evidence',
      fromNodeId: node.id,
      toNodeId: projectNodeIdValue,
      label: 'Runtime unknown needs evidence',
      summary: unknown.suggestedAction,
      source: 'pie-runtime',
      confidence: unknown.confidence,
      evidence: [unknown.summary],
      metadata: {},
    });
  });
}

function addMemoryEdges(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  projectNodeIdValue: string,
) {
  const memory = parts.memory;
  if (!memory) return;

  memory.insights.forEach(insight => {
    const insightNode = addNode(builder, {
      id: evidenceNodeId(`memory-insight-${insight.id}`),
      type: 'evidence',
      projectName: insight.projectName || parts.projectName,
      label: insight.title,
      summary: insight.summary,
      source: 'pie-memory',
      confidence: insight.confidence,
      occurredAt: memory.generatedAt,
      relatedRecordId: insight.id,
      metadata: {
        priority: insight.priority,
        supportingPatternIds: insight.supportingPatternIds,
        supportingGapIds: insight.supportingGapIds,
        supportingEventIds: insight.supportingEventIds,
      },
    });
    addEdge(builder, {
      type: 'updates_story',
      fromNodeId: insightNode.id,
      toNodeId: projectNodeIdValue,
      label: 'Memory insight updates story',
      summary: insight.whyItMatters,
      source: 'pie-memory',
      confidence: insight.confidence,
      evidence: [insight.summary],
      metadata: {},
    });
  });

  memory.gaps.forEach(gap => {
    const unknownNode = addUnknownNode(builder, parts, {
      id: `memory-gap-${gap.id}`,
      label: gap.title,
      summary: gap.summary,
      source: 'pie-memory',
      confidence: gap.confidence,
      relatedRecordId: gap.id,
      occurredAt: memory.generatedAt,
      metadata: {
        priority: gap.priority,
        impact: gap.impact,
        source: gap.source,
        ...gap.metadata,
      },
    });
    addEdge(builder, {
      type: 'needs_evidence',
      fromNodeId: unknownNode.id,
      toNodeId: projectNodeIdValue,
      label: 'Memory gap needs evidence',
      summary: gap.suggestedAction,
      source: 'pie-memory',
      confidence: gap.confidence,
      evidence: [gap.summary],
      metadata: {},
    });
  });
}

function addConcernNode(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  concern: PIEConcern,
): PIEGraphNode {
  const lowerText = `${concern.title} ${concern.summary} ${concern.impact}`.toLowerCase();
  const type: PIEGraphNodeType = lowerText.includes('safety')
    ? 'safety'
    : lowerText.includes('inspection')
      ? 'inspection'
      : 'issue';

  return addIssueLikeNode(builder, parts, {
    type,
    id: `concern-${concern.id}`,
    label: concern.title,
    summary: concern.summary,
    source: 'pie-reasoning',
    confidence: concern.confidence,
    relatedRecordId: concern.id,
    occurredAt: concern.createdAt,
    metadata: {
      impact: concern.impact,
      priority: concern.priority,
      suggestedNextAction: concern.suggestedNextAction,
      ...concern.metadata,
    },
  });
}

function addReasoningRecommendation(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  recommendation: PIEThoughtRecommendation,
  evidenceNodes: PIEGraphNode[],
) {
  const recommendationNode = addRecommendationNode(builder, parts, {
    id: `reasoning-${recommendation.id}`,
    label: recommendation.title,
    summary: recommendation.why,
    source: 'pie-reasoning',
    confidence: recommendation.confidence,
    relatedRecordId: recommendation.id,
    occurredAt: recommendation.createdAt,
    metadata: {
      impact: recommendation.impact,
      suggestedNextAction: recommendation.suggestedNextAction,
      priority: recommendation.priority,
      ...recommendation.metadata,
    },
  });

  connectEvidenceIds(
    builder,
    recommendationNode.id,
    recommendation.evidenceIds,
    evidenceNodes,
    'supports',
    recommendation.why,
    recommendation.confidence,
  );
}

function addDecisionNode(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  decision: PIEDecision,
  projectNodeIdValue: string,
) {
  const decisionNode = addNode(builder, {
    id: decisionNodeId(decision.id),
    type: 'decision',
    projectName: decision.projectName || parts.projectName,
    label: decision.title,
    summary: decision.summary,
    source: 'pie-decision',
    confidence: decision.confidence,
    occurredAt: decision.createdAt,
    relatedRecordId: decision.id,
    metadata: {
      action: decision.action,
      priority: decision.priority,
      impact: decision.impact,
      userApproval: decision.userApproval,
    },
  });

  addEdge(builder, {
    type: 'belongs_to',
    fromNodeId: decisionNode.id,
    toNodeId: projectNodeIdValue,
    label: 'Decision belongs to project',
    summary: `${decision.title} belongs to ${parts.projectName}.`,
    source: 'pie-decision',
    confidence: decision.confidence,
    evidence: decision.evidence,
    metadata: {},
  });

  if (decision.userApproval.required) {
    const approvalNode = addUnknownNode(builder, parts, {
      id: `approval-${decision.id}`,
      label: 'User Approval Required',
      summary: decision.userApproval.reason,
      source: 'pie-decision',
      confidence: decision.confidence,
      relatedRecordId: decision.id,
      occurredAt: decision.createdAt,
      metadata: decision.userApproval as unknown as Record<string, unknown>,
    });
    addEdge(builder, {
      type: 'requires_approval',
      fromNodeId: decisionNode.id,
      toNodeId: approvalNode.id,
      label: 'Decision requires approval',
      summary: decision.userApproval.reason,
      source: 'pie-decision',
      confidence: decision.confidence,
      evidence: decision.evidence,
      metadata: {},
    });
  }

  decision.evidence.forEach((evidenceText, index) => {
    const evidenceNode = addNode(builder, {
      id: evidenceNodeId(`decision-${decision.id}-${index}`),
      type: 'evidence',
      projectName: parts.projectName,
      label: 'Decision Evidence',
      summary: evidenceText,
      source: 'pie-decision',
      confidence: decision.confidence,
      occurredAt: decision.createdAt,
      relatedRecordId: decision.id,
      metadata: {
        decisionId: decision.id,
      },
    });
    addEdge(builder, {
      type: 'supports',
      fromNodeId: evidenceNode.id,
      toNodeId: decisionNode.id,
      label: 'Evidence supports decision',
      summary: evidenceText,
      source: 'pie-decision',
      confidence: decision.confidence,
      evidence: [evidenceText],
      metadata: {},
    });
  });
}

function connectRecommendationEvidence(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  recommendationNodeIdValue: string,
  recommendation: PIERecommendation,
  projectNodeIdValue: string,
) {
  if (recommendation.evidence.length === 0) {
    addEdge(builder, {
      type: 'needs_evidence',
      fromNodeId: recommendationNodeIdValue,
      toNodeId: projectNodeIdValue,
      label: 'Recommendation needs evidence',
      summary: `${recommendation.title} needs stronger supporting evidence.`,
      source: 'pie-runtime',
      confidence: recommendation.confidence,
      evidence: [],
      metadata: {},
    });
    return;
  }

  recommendation.evidence.forEach((evidenceText, index) => {
    const evidenceNode = addNode(builder, {
      id: evidenceNodeId(`runtime-recommendation-${recommendation.id}-${index}`),
      type: 'evidence',
      projectName: parts.projectName,
      label: 'Recommendation Evidence',
      summary: evidenceText,
      source: 'pie-runtime',
      confidence: recommendation.confidence,
      occurredAt: parts.generatedAt,
      relatedRecordId: recommendation.id,
      metadata: {
        recommendationId: recommendation.id,
      },
    });
    addEdge(builder, {
      type: 'supports',
      fromNodeId: evidenceNode.id,
      toNodeId: recommendationNodeIdValue,
      label: 'Evidence supports recommendation',
      summary: evidenceText,
      source: 'pie-runtime',
      confidence: recommendation.confidence,
      evidence: [evidenceText],
      metadata: {},
    });
  });
}

function addIssueLikeNode(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  input: {
    type: 'issue' | 'safety' | 'inspection';
    id: string;
    label: string;
    summary: string;
    source: PIEGraphSource;
    confidence: ProjectConfidenceLevel;
    occurredAt: string | null;
    relatedRecordId: string | null;
    metadata: Record<string, unknown>;
  },
): PIEGraphNode {
  return addNode(builder, {
    id: `${input.type}:${slug(parts.projectName)}:${slug(input.id)}`,
    type: input.type,
    projectName: parts.projectName,
    label: input.label,
    summary: input.summary,
    source: input.source,
    confidence: input.confidence,
    occurredAt: input.occurredAt,
    relatedRecordId: input.relatedRecordId,
    metadata: input.metadata,
  });
}

function addRecommendationNode(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  input: {
    id: string;
    label: string;
    summary: string;
    source: PIEGraphSource;
    confidence: ProjectConfidenceLevel;
    occurredAt: string | null;
    relatedRecordId: string | null;
    metadata: Record<string, unknown>;
  },
): PIEGraphNode {
  return addNode(builder, {
    id: recommendationNodeId(input.id),
    type: 'recommendation',
    projectName: parts.projectName,
    label: input.label,
    summary: input.summary,
    source: input.source,
    confidence: input.confidence,
    occurredAt: input.occurredAt,
    relatedRecordId: input.relatedRecordId,
    metadata: input.metadata,
  });
}

function addUnknownNode(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  input: {
    id: string;
    label: string;
    summary: string;
    source: PIEGraphSource;
    confidence: ProjectConfidenceLevel;
    occurredAt: string | null;
    relatedRecordId: string | null;
    metadata: Record<string, unknown>;
  },
): PIEGraphNode {
  return addNode(builder, {
    id: unknownNodeId(input.id),
    type: 'unknown',
    projectName: parts.projectName,
    label: input.label,
    summary: input.summary,
    source: input.source,
    confidence: input.confidence,
    occurredAt: input.occurredAt,
    relatedRecordId: input.relatedRecordId,
    metadata: input.metadata,
  });
}

function contractorOrPersonNode(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  name: string,
  source: PIEGraphSource,
): PIEGraphNode {
  const contact = parts.contacts.find(
    candidate => normalizedKey(candidate.name) === normalizedKey(name),
  );
  const isKnownPerson = Boolean(contact);

  return addNode(builder, {
    id: isKnownPerson
      ? personNodeId(parts.projectName, contact?.id || name)
      : contractorNodeId(parts.projectName, name),
    type: isKnownPerson ? 'person' : 'contractor',
    projectName: parts.projectName,
    label: contact?.name || name,
    summary: isKnownPerson
      ? `${contact?.name || name} is a known contact.`
      : `${name} is referenced as a contractor or responsible party.`,
    source,
    confidence: isKnownPerson ? 'medium' : 'low',
    occurredAt: parts.generatedAt,
    relatedRecordId: contact?.id ?? null,
    metadata: (contact ?? { name }) as unknown as Record<string, unknown>,
  });
}

function connectAreaByName(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  fromNodeId: string,
  areaName: string | null | undefined,
  source: PIEGraphSource,
) {
  if (!areaName?.trim()) return;

  const areaNode = addNode(builder, {
    id: areaNodeId(parts.projectName, areaName),
    type: 'area',
    projectName: parts.projectName,
    label: areaName,
    summary: `Project area ${areaName}.`,
    source,
    confidence: 'medium',
    occurredAt: parts.generatedAt,
    relatedRecordId: areaName,
    metadata: {},
  });

  addEdge(builder, {
    type: 'located_in',
    fromNodeId,
    toNodeId: areaNode.id,
    label: 'Located in area',
    summary: `Node is connected to area ${areaName}.`,
    source,
    confidence: 'medium',
    evidence: [areaName],
    metadata: {},
  });
}

function connectAreaByText(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  fromNodeId: string,
  text: string,
  source: PIEGraphSource,
) {
  const normalized = text.toLowerCase();
  const area = parts.projectAreas.find(candidate =>
    normalized.includes(candidate.name.toLowerCase()) ||
    Boolean(candidate.building && normalized.includes(candidate.building.toLowerCase())),
  );

  if (!area) return;

  connectAreaByName(builder, parts, fromNodeId, area.name, source);
}

function connectRecipients(
  builder: GraphBuilder,
  parts: GraphBuildParts,
  fromNodeId: string,
  contactIds: string[],
) {
  contactIds.forEach(contactId => {
    const contact = parts.contacts.find(candidate => candidate.id === contactId);
    if (!contact) return;

    const personNode = contractorOrPersonNode(builder, parts, contact.name, 'contact');
    addEdge(builder, {
      type: 'mentions',
      fromNodeId,
      toNodeId: personNode.id,
      label: 'Update mentions recipient',
      summary: `Update includes recipient ${contact.name}.`,
      source: 'contact',
      confidence: 'medium',
      evidence: [contact.name],
      metadata: {
        contactId,
      },
    });
  });
}

function connectEvidenceIds(
  builder: GraphBuilder,
  targetNodeId: string,
  evidenceIds: string[],
  evidenceNodes: PIEGraphNode[],
  edgeType: 'supports' | 'needs_evidence',
  summary: string,
  confidence: ProjectConfidenceLevel,
) {
  evidenceIds.forEach(evidenceId => {
    const evidenceNode = evidenceNodes.find(node =>
      node.id === evidenceNodeId(evidenceId) ||
      node.relatedRecordId === evidenceId,
    );
    if (!evidenceNode) return;

    addEdge(builder, {
      type: edgeType,
      fromNodeId: evidenceNode.id,
      toNodeId: targetNodeId,
      label: edgeType === 'supports' ? 'Evidence supports node' : 'Evidence gap',
      summary,
      source: 'pie-reasoning',
      confidence,
      evidence: [evidenceNode.summary],
      metadata: {
        evidenceId,
      },
    });
  });
}

function addNode(builder: GraphBuilder, node: PIEGraphNode): PIEGraphNode {
  const existing = builder.nodes.get(node.id);
  if (!existing) {
    builder.nodes.set(node.id, {
      ...node,
      label: compact(node.label),
      summary: compact(node.summary),
    });
    return builder.nodes.get(node.id) as PIEGraphNode;
  }

  builder.nodes.set(node.id, {
    ...existing,
    confidence: higherConfidence(existing.confidence, node.confidence),
    summary: longestText(existing.summary, node.summary),
    metadata: {
      ...existing.metadata,
      ...node.metadata,
    },
  });

  return builder.nodes.get(node.id) as PIEGraphNode;
}

function addEdge(
  builder: GraphBuilder,
  edge: Omit<PIEGraphEdge, 'id' | 'projectName'>,
): PIEGraphEdge {
  const id = edgeId(edge.type, edge.fromNodeId, edge.toNodeId, edge.label);
  const existing = builder.edges.get(id);

  if (!existing) {
    const nextEdge = {
      ...edge,
      id,
      projectName: builder.projectName,
      evidence: uniqueText(edge.evidence),
      summary: compact(edge.summary),
    };
    builder.edges.set(id, nextEdge);
    return nextEdge;
  }

  const nextEdge = {
    ...existing,
    confidence: higherConfidence(existing.confidence, edge.confidence),
    summary: longestText(existing.summary, edge.summary),
    evidence: uniqueText([...existing.evidence, ...edge.evidence]),
    metadata: {
      ...existing.metadata,
      ...edge.metadata,
    },
  };
  builder.edges.set(id, nextEdge);

  return nextEdge;
}

function buildRelationships(
  projectName: string,
  nodes: PIEGraphNode[],
  edges: PIEGraphEdge[],
): PIEGraphRelationship[] {
  return edges
    .map(edge => {
      const fromNode = nodes.find(node => node.id === edge.fromNodeId);
      const toNode = nodes.find(node => node.id === edge.toNodeId);
      if (!fromNode || !toNode) return null;

      return {
        id: `relationship:${edge.id}`,
        projectName,
        edgeType: edge.type,
        fromNode,
        toNode,
        edge,
        summary: edge.summary,
        confidence: edge.confidence,
      };
    })
    .filter((relationship): relationship is PIEGraphRelationship =>
      Boolean(relationship),
    );
}

function buildGraphGapsFromParts(
  parts: GraphBuildParts,
  nodes: PIEGraphNode[],
  edges: PIEGraphEdge[],
): PIEGraphGap[] {
  const gaps: PIEGraphGap[] = [];
  const hasNodeType = (type: PIEGraphNodeType) =>
    nodes.some(node => node.type === type);
  const recommendationsWithoutEvidence = nodes.filter(
    node =>
      node.type === 'recommendation' &&
      !edges.some(
        edge => edge.toNodeId === node.id && edge.type === 'supports',
      ),
  );

  if (!hasNodeType('update')) {
    gaps.push(graphGap(parts, {
      id: 'missing-updates',
      title: 'No update evidence',
      summary: 'PIE does not see saved update nodes in the graph.',
      missingNodeType: 'update',
      severity: 'high',
      suggestedAction: 'Capture or sync recent project updates.',
    }));
  }

  if (!hasNodeType('photo')) {
    gaps.push(graphGap(parts, {
      id: 'missing-photos',
      title: 'No photo evidence',
      summary: 'PIE does not see photo nodes in the graph.',
      missingNodeType: 'photo',
      severity: 'medium',
      suggestedAction: 'Capture current field photos with captions.',
    }));
  }

  if (!hasNodeType('schedule_item')) {
    gaps.push(graphGap(parts, {
      id: 'missing-schedule',
      title: 'No schedule evidence',
      summary: 'PIE does not see schedule item nodes in the graph.',
      missingNodeType: 'schedule_item',
      severity: 'high',
      suggestedAction: 'Import or enter schedule items.',
    }));
  }

  if (!hasNodeType('document')) {
    gaps.push(graphGap(parts, {
      id: 'missing-documents',
      title: 'No document context',
      summary: 'PIE does not see document metadata linked to this project graph.',
      missingNodeType: 'document',
      severity: 'medium',
      suggestedAction: 'Add current reference documents or schedule documents.',
    }));
  }

  if (!hasNodeType('report')) {
    gaps.push(graphGap(parts, {
      id: 'missing-reports',
      title: 'No report history',
      summary: 'PIE does not see report history nodes in the graph.',
      missingNodeType: 'report',
      severity: 'low',
      suggestedAction: 'Generate and review a project report when communication is needed.',
    }));
  }

  recommendationsWithoutEvidence.forEach(recommendation => {
    gaps.push(graphGap(parts, {
      id: `recommendation-needs-evidence-${recommendation.id}`,
      title: 'Recommendation needs evidence',
      summary: `${recommendation.label} does not have a direct supporting evidence edge.`,
      missingNodeType: 'evidence',
      severity: 'high',
      suggestedAction: 'Review or add evidence before acting on this recommendation.',
      relatedNodeIds: [recommendation.id],
    }));
  });

  return dedupeGraphGaps(gaps);
}

function buildGraphInsightsFromParts(
  parts: GraphBuildParts,
  nodes: PIEGraphNode[],
  edges: PIEGraphEdge[],
  relationships: PIEGraphRelationship[],
  gaps: PIEGraphGap[],
): PIEGraphInsight[] {
  const insights: PIEGraphInsight[] = [];
  const blockedRelationships = relationships.filter(
    relationship => relationship.edgeType === 'blocks',
  );
  const approvalEdges = edges.filter(edge => edge.type === 'requires_approval');
  const supportEdges = edges.filter(edge => edge.type === 'supports');
  const areaRiskRelationships = relationships.filter(
    relationship =>
      relationship.edgeType === 'located_in' &&
      ['issue', 'safety', 'inspection'].includes(relationship.fromNode.type),
  );
  const peopleRelationships = relationships.filter(relationship =>
    ['assigned_to', 'mentions'].includes(relationship.edgeType) &&
    ['person', 'contractor'].includes(relationship.toNode.type),
  );

  if (supportEdges.length > 0) {
    insights.push({
      id: 'graph-supported-recommendations',
      projectName: parts.projectName,
      title: 'Evidence is connected to recommendations',
      summary: `${supportEdges.length} support relationship${supportEdges.length === 1 ? '' : 's'} connect evidence to project understanding, issues, decisions, or recommendations.`,
      confidence: 'medium',
      priority: 'medium',
      nodeIds: uniqueText(
        supportEdges.flatMap(edge => [edge.fromNodeId, edge.toNodeId]),
      ),
      edgeIds: supportEdges.map(edge => edge.id),
      relationshipIds: relationships
        .filter(relationship => relationship.edgeType === 'supports')
        .map(relationship => relationship.id),
      suggestedNextAction: 'Use connected evidence when reviewing PIE recommendations.',
    });
  }

  if (blockedRelationships.length > 0) {
    insights.push({
      id: 'graph-blocked-items',
      projectName: parts.projectName,
      title: 'Blocked items are visible',
      summary: `${blockedRelationships.length} relationship${blockedRelationships.length === 1 ? '' : 's'} show issues blocking schedule or project items.`,
      confidence: 'medium',
      priority: 'high',
      nodeIds: uniqueText(
        blockedRelationships.flatMap(relationship => [
          relationship.fromNode.id,
          relationship.toNode.id,
        ]),
      ),
      edgeIds: blockedRelationships.map(relationship => relationship.edge.id),
      relationshipIds: blockedRelationships.map(relationship => relationship.id),
      suggestedNextAction: 'Review blocked items before generating status communication.',
    });
  }

  if (areaRiskRelationships.length > 0) {
    insights.push({
      id: 'graph-area-risk-connections',
      projectName: parts.projectName,
      title: 'Risks are connected to project areas',
      summary: `${areaRiskRelationships.length} area relationship${areaRiskRelationships.length === 1 ? '' : 's'} connect issues, safety, or inspection context to project areas.`,
      confidence: 'medium',
      priority: 'medium',
      nodeIds: uniqueText(
        areaRiskRelationships.flatMap(relationship => [
          relationship.fromNode.id,
          relationship.toNode.id,
        ]),
      ),
      edgeIds: areaRiskRelationships.map(relationship => relationship.edge.id),
      relationshipIds: areaRiskRelationships.map(relationship => relationship.id),
      suggestedNextAction: 'Use area connections to guide Project Walk verification.',
    });
  }

  if (peopleRelationships.length > 0) {
    insights.push({
      id: 'graph-people-connections',
      projectName: parts.projectName,
      title: 'People and contractors are connected',
      summary: `${peopleRelationships.length} relationship${peopleRelationships.length === 1 ? '' : 's'} connect project records to people or contractors.`,
      confidence: 'medium',
      priority: 'medium',
      nodeIds: uniqueText(
        peopleRelationships.flatMap(relationship => [
          relationship.fromNode.id,
          relationship.toNode.id,
        ]),
      ),
      edgeIds: peopleRelationships.map(relationship => relationship.edge.id),
      relationshipIds: peopleRelationships.map(relationship => relationship.id),
      suggestedNextAction: 'Use people connections when assigning or communicating next actions.',
    });
  }

  if (approvalEdges.length > 0) {
    insights.push({
      id: 'graph-approval-required',
      projectName: parts.projectName,
      title: 'Approval-required decisions are connected',
      summary: `${approvalEdges.length} decision relationship${approvalEdges.length === 1 ? '' : 's'} require user approval.`,
      confidence: 'high',
      priority: 'high',
      nodeIds: uniqueText(
        approvalEdges.flatMap(edge => [edge.fromNodeId, edge.toNodeId]),
      ),
      edgeIds: approvalEdges.map(edge => edge.id),
      relationshipIds: relationships
        .filter(relationship => relationship.edgeType === 'requires_approval')
        .map(relationship => relationship.id),
      suggestedNextAction: 'Review approval-required decisions before PIE acts.',
    });
  }

  if (gaps.length > 0) {
    insights.push({
      id: 'graph-missing-information',
      projectName: parts.projectName,
      title: 'Knowledge graph has missing information',
      summary: `${gaps.length} graph gap${gaps.length === 1 ? '' : 's'} limit relationship confidence.`,
      confidence: 'high',
      priority: gaps.some(gap => gap.severity === 'high') ? 'high' : 'medium',
      nodeIds: uniqueText(gaps.flatMap(gap => gap.relatedNodeIds)),
      edgeIds: [],
      relationshipIds: [],
      suggestedNextAction: gaps[0]?.suggestedAction || 'Add missing project context.',
    });
  }

  return insights;
}

function graphGap(
  parts: GraphBuildParts,
  input: {
    id: string;
    title: string;
    summary: string;
    missingNodeType: PIEGraphNodeType | null;
    severity: PIEDecisionPriority;
    suggestedAction: string;
    relatedNodeIds?: string[];
  },
): PIEGraphGap {
  return {
    id: `graph-gap:${slug(parts.projectName)}:${input.id}`,
    projectName: parts.projectName,
    title: input.title,
    summary: input.summary,
    missingNodeType: input.missingNodeType,
    severity: input.severity,
    confidence: 'high',
    relatedNodeIds: input.relatedNodeIds ?? [],
    suggestedAction: input.suggestedAction,
  };
}

function normalizeGraph(input: GraphInput): PIEGraph {
  if (isGraph(input)) return input;

  return buildPIEKnowledgeGraph(input);
}

function isGraph(input: GraphInput): input is PIEGraph {
  return Boolean(input) && typeof input === 'object' && 'nodes' in input && 'edges' in input;
}

function filterUpdatesForProject(
  updates: ProjectUpdate[],
  projectName: string,
): ProjectUpdate[] {
  return updates.filter(update =>
    sameProject(update.projectName, projectName),
  );
}

function filterScheduleForProject(
  scheduleItems: ScheduleItem[],
  projectName: string,
): ScheduleItem[] {
  return scheduleItems.filter(item =>
    sameProject(item.projectName, projectName),
  );
}

function filterReportsForProject(
  reports: ProjectReportHistoryMetadata[],
  projectName: string,
): ProjectReportHistoryMetadata[] {
  return reports.filter(report =>
    !report.projectName || sameProject(report.projectName, projectName),
  );
}

function contactList(
  contacts?: ContactBook | ProjectContact[],
): ProjectContact[] {
  if (!contacts) return [];
  if (Array.isArray(contacts)) return contacts;

  return contacts.contacts;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map<string, T>();
  items.forEach(item => {
    byId.set(item.id, item);
  });

  return Array.from(byId.values());
}

function countNodesByType(nodes: PIEGraphNode[]): Record<PIEGraphNodeType, number> {
  const counts = {
    project: 0,
    area: 0,
    photo: 0,
    update: 0,
    schedule_item: 0,
    document: 0,
    report: 0,
    person: 0,
    contractor: 0,
    issue: 0,
    safety: 0,
    inspection: 0,
    decision: 0,
    recommendation: 0,
    unknown: 0,
    event: 0,
    evidence: 0,
  } satisfies Record<PIEGraphNodeType, number>;

  nodes.forEach(node => {
    counts[node.type] += 1;
  });

  return counts;
}

function eventTypeToNodeType(event: ProjectEvent): PIEGraphNodeType {
  if (event.eventType === 'photo_added') return 'photo';
  if (event.eventType === 'update_created') return 'update';
  if (
    event.eventType === 'schedule_imported' ||
    event.eventType === 'schedule_item_overdue'
  ) {
    return 'schedule_item';
  }
  if (event.eventType === 'report_generated') return 'report';
  if (event.eventType === 'issue_created' || event.eventType === 'issue_closed') {
    return 'issue';
  }
  if (event.eventType === 'safety_observation') return 'safety';
  if (event.eventType === 'inspection_event') return 'inspection';
  if (event.eventType === 'decision_recorded') return 'decision';

  return 'event';
}

function photoSummary(photo: UpdatePhoto): string {
  return compact(
    [
      photo.caption || 'Project photo.',
      `Category: ${photo.category}.`,
      photo.actionRequired ? `Action: ${photo.actionRequired}.` : null,
      photo.actionOwner ? `Owner: ${photo.actionOwner}.` : null,
      photo.actionDueDate ? `Due: ${photo.actionDueDate}.` : null,
      photo.actionStatus ? `Status: ${photo.actionStatus}.` : null,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function scheduleSummary(item: ScheduleItem): string {
  return compact(
    [
      `${item.taskName}: ${item.status}, ${item.percentComplete}% complete.`,
      item.finishDate ? `Finish: ${item.finishDate}.` : null,
      item.owner ? `Owner: ${item.owner}.` : null,
      item.contractor ? `Contractor: ${item.contractor}.` : null,
      item.priority ? `Priority: ${item.priority}.` : null,
      item.notes || null,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function isScheduleBlocked(item: ScheduleItem): boolean {
  if (item.status === 'Waiting') return true;
  if (item.priority === 'High' && item.status !== 'Complete') return true;

  const finishTime = Date.parse(item.finishDate);
  if (!Number.isFinite(finishTime)) return false;

  return finishTime < Date.now() && item.status !== 'Complete';
}

function sameProject(value: string | null | undefined, projectName: string): boolean {
  return normalizedKey(value || '') === normalizedKey(projectName);
}

function formatDateLabel(value: string) {
  if (!value) return 'Undated';

  return value;
}

function projectNodeId(projectName: string) {
  return `project:${slug(projectName)}`;
}

function areaNodeId(projectName: string, areaIdOrName: string) {
  return `area:${slug(projectName)}:${slug(areaIdOrName)}`;
}

function updateNodeId(updateId: string) {
  return `update:${slug(updateId)}`;
}

function photoNodeId(photoId: string) {
  return `photo:${slug(photoId)}`;
}

function scheduleNodeId(scheduleItemId: string) {
  return `schedule:${slug(scheduleItemId)}`;
}

function documentNodeId(documentId: string) {
  return `document:${slug(documentId)}`;
}

function reportNodeId(reportId: string) {
  return `report:${slug(reportId)}`;
}

function eventNodeId(eventId: string) {
  return `event:${slug(eventId)}`;
}

function evidenceNodeId(evidenceId: string) {
  return `evidence:${slug(evidenceId)}`;
}

function decisionNodeId(decisionId: string) {
  return `decision:${slug(decisionId)}`;
}

function recommendationNodeId(recommendationId: string) {
  return `recommendation:${slug(recommendationId)}`;
}

function unknownNodeId(unknownId: string) {
  return `unknown:${slug(unknownId)}`;
}

function personNodeId(projectName: string, personIdOrName: string) {
  return `person:${slug(projectName)}:${slug(personIdOrName)}`;
}

function contractorNodeId(projectName: string, contractorName: string) {
  return `contractor:${slug(projectName)}:${slug(contractorName)}`;
}

function edgeId(
  type: PIEGraphEdgeType,
  fromNodeId: string,
  toNodeId: string,
  label: string,
) {
  return `edge:${type}:${slug(fromNodeId)}:${slug(toNodeId)}:${slug(label)}`;
}

function higherConfidence(
  first: ProjectConfidenceLevel,
  second: ProjectConfidenceLevel,
): ProjectConfidenceLevel {
  return confidenceRank(second) > confidenceRank(first) ? second : first;
}

function confidenceRank(confidence: ProjectConfidenceLevel) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;

  return 1;
}

function dedupeGraphGaps(gaps: PIEGraphGap[]): PIEGraphGap[] {
  const byId = new Map<string, PIEGraphGap>();

  gaps.forEach(gap => {
    byId.set(gap.id, gap);
  });

  return Array.from(byId.values());
}

function uniqueText(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach(value => {
    const text = value?.trim();
    if (!text) return;

    const key = text.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    result.push(text);
  });

  return result;
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function slug(value: string) {
  const nextValue = value || 'unknown';

  return nextValue.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function longestText(first: string, second: string) {
  return second.length > first.length ? second : first;
}
