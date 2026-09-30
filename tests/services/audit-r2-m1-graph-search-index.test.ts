/**
 * Audit round 2, M1a (30 Sep 2026): findRelatedNodes runs once per open issue
 * and scanned every edge, then every node, for each step. It now uses a node
 * map and per-node edge lists built once per graph. The output must be
 * byte-identical to the old full scan: this test keeps a verbatim copy of the
 * old algorithm and compares both, with a fixed clock, for every node of a
 * real runtime graph and every option shape the app uses.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import { buildRuntime } from '../../services/PIERuntime';
import {
  findRelatedNodes,
  getConnectedEvidence,
  type FindRelatedNodesOptions,
  type PIEGraph,
  type PIEGraphNode,
} from '../../services/PIEKnowledgeGraph';

/** The pre-index algorithm, verbatim apart from taking a built graph. */
function referenceFindRelatedNodes(
  graph: PIEGraph,
  nodeId: string,
  options: FindRelatedNodesOptions = {},
): PIEGraphNode[] {
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

const EVIDENCE_NODE_TYPES = [
  'photo', 'update', 'schedule_item', 'document', 'report', 'event', 'evidence', 'decision',
] as FindRelatedNodesOptions['nodeTypes'];

const OPTION_SHAPES: FindRelatedNodesOptions[] = [
  {},
  { direction: 'incoming' },
  { direction: 'outgoing', maxDepth: 3 },
  { nodeTypes: EVIDENCE_NODE_TYPES, direction: 'both', maxDepth: 2 },
  { edgeTypes: ['supports', 'depends_on', 'needs_evidence'], nodeTypes: EVIDENCE_NODE_TYPES, direction: 'incoming', maxDepth: 2 },
  { edgeTypes: ['located_in', 'blocks'], maxDepth: 4 },
];

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-30T15:00:00.000Z');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function runtimeContext() {
  const projects = ['Alpha Hangar', 'Bravo Hangar'];
  const areas = projects.flatMap(project => [1, 2, 3].map(n => ({ project, name: `${project.split(' ')[0]} Bay ${n}` })));
  const scheduleItems = Array.from({ length: 40 }, (_, i) => {
    const project = projects[i % 2];
    const area = areas.filter(item => item.project === project)[i % 3];
    return {
      id: `task-${i}`, projectName: project, scheduleProjectName: project, locationName: area.name,
      taskName: `Task ${i} ${['electrical rough-in', 'drywall hang', 'sprinkler test'][i % 3]}`,
      startDate: day(NOW - (20 - i) * DAY), finishDate: day(NOW - (10 - i) * DAY), milestone: '',
      owner: i % 2 ? 'David' : 'Sub A', contractor: '', percentComplete: (i * 9) % 100,
      priority: i % 4 === 0 ? 'High' : 'Normal', status: i % 5 === 0 ? 'Complete' : 'In Progress',
      notes: i % 2 === 0 ? 'Waiting on inspection sign-off.' : '', importedFrom: 'schedule.pdf',
      importedAt: '2026-09-01T08:00:00.000Z', createdAt: '2026-09-01T08:00:00.000Z',
    };
  });
  const updates = Array.from({ length: 30 }, (_, u) => {
    const project = projects[u % 2];
    const area = areas.filter(item => item.project === project)[u % 3];
    const at = NOW - (30 - u) * DAY;
    const openIssue = u % 5 === 0;
    return {
      id: `update-${u}`, projectName: project, scheduleProjectName: project, date: day(at),
      notes: u % 2 ? `Concrete pour completed in ${area.name}.` : `Rough-in continues in ${area.name}; panel conflict needs review.`,
      recipients: { contactIds: [] }, status: 'sent', selectedAreaName: area.name,
      scheduleItemId: u % 3 === 0 ? `task-${u % 40}` : null,
      photos: [0, 1].map(p => ({
        id: `photo-${u}-${p}`, uri: `file:///p/${u}-${p}.jpg`, caption: p ? '' : 'Progress at east wall',
        category: openIssue && p === 0 ? (u % 10 === 0 ? 'Safety Concern' : 'Open Issue') : 'Update',
        actionRequired: openIssue && p === 0 ? `Close junction boxes in ${area.name}` : '',
        actionOwner: openIssue && p === 0 ? 'Sub A' : '', actionDueDate: '', actionStatus: openIssue && p === 0 ? 'Open' : 'Closed',
        selectedAreaName: area.name, locationCapturedAt: new Date(at + p * 60_000).toISOString(),
      })),
    };
  });
  return {
    projectName: projects[0], projectNames: [projects[0]],
    updates, scheduleItems, currentUpdate: null,
    projectAreas: areas.map((area, i) => ({ id: `area-${i}`, name: area.name, projectName: area.project, latitude: null, longitude: null, radiusFeet: 150, locationCapturedAt: null })),
    contacts: { contacts: [] }, referenceDocuments: [], surface: 'home' as const,
  };
}

describe('M1a: the indexed graph search returns exactly what the full scan returned', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('matches the old algorithm byte for byte for every node of a real runtime graph', () => {
    const runtime = buildRuntime(runtimeContext() as never);
    const graph = runtime.knowledgeGraph;
    expect(graph.nodes.length).toBeGreaterThan(50);
    expect(graph.edges.length).toBeGreaterThan(50);
    const nodeIds = [...graph.nodes.map(node => node.id), 'no-such-node'];
    let compared = 0;
    for (const nodeId of nodeIds) {
      for (const options of OPTION_SHAPES) {
        expect(JSON.stringify(findRelatedNodes(graph, nodeId, options)))
          .toBe(JSON.stringify(referenceFindRelatedNodes(graph, nodeId, options)));
        compared += 1;
      }
    }
    expect(compared).toBe(nodeIds.length * OPTION_SHAPES.length);
    // The runtime's per-issue evidence (the caller the index was built for).
    expect(runtime.areaLinkedRisks.length).toBeGreaterThan(0);
    for (const risk of runtime.areaLinkedRisks) {
      expect(JSON.stringify(risk.evidence)).toBe(JSON.stringify(referenceFindRelatedNodes(
        graph,
        risk.relationship.fromNode.id,
        { nodeTypes: EVIDENCE_NODE_TYPES, direction: 'both', maxDepth: 2 },
      )));
    }
  });

  it('the whole runtime is byte-identical from build to build with a fixed clock', () => {
    const first = JSON.stringify(buildRuntime(runtimeContext() as never));
    const second = JSON.stringify(buildRuntime(runtimeContext() as never));
    expect(second).toBe(first);
  });

  it('searching for every open issue reads the edge and node lists once, not once per search step', () => {
    const runtime = buildRuntime(runtimeContext() as never);
    let reads = 0;
    const counted = <T extends object>(list: T[]) => new Proxy(list, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    const graph = {
      ...runtime.knowledgeGraph,
      nodes: counted(runtime.knowledgeGraph.nodes),
      edges: counted(runtime.knowledgeGraph.edges),
    } as PIEGraph;
    for (const node of graph.nodes.slice(0, 40)) {
      findRelatedNodes(graph, node.id, { nodeTypes: EVIDENCE_NODE_TYPES, direction: 'both', maxDepth: 2 });
    }
    reads = 0;
    for (const node of runtime.knowledgeGraph.nodes.slice(0, 40)) {
      findRelatedNodes(graph, node.id, { nodeTypes: EVIDENCE_NODE_TYPES, direction: 'both', maxDepth: 2 });
    }
    // Once indexed, a search reads neither list; the full scan read every
    // edge for every node on the frontier, tens of thousands of reads here.
    expect(reads).toBe(0);
  });

  it('keeps first-node-wins, self-loops, and sees edges added after the first search', () => {
    const node = (id: string, label: string) => ({ id, type: 'update', label }) as unknown as PIEGraphNode;
    const edge = (id: string, fromNodeId: string, toNodeId: string, type = 'supports') =>
      ({ id, type, fromNodeId, toNodeId }) as never;
    const graph = {
      nodes: [node('a', 'A'), node('b', 'first B'), node('b', 'second B'), node('c', 'C')],
      edges: [edge('e1', 'a', 'a'), edge('e2', 'c', 'a'), edge('e3', 'a', 'b', 'blocks'), edge('e4', 'b', 'c')],
    } as unknown as PIEGraph;
    for (const options of OPTION_SHAPES) {
      expect(JSON.stringify(findRelatedNodes(graph, 'a', options)))
        .toBe(JSON.stringify(referenceFindRelatedNodes(graph, 'a', options)));
    }
    expect(findRelatedNodes(graph, 'a').map(item => item.label)).toEqual(['C', 'first B']);
    graph.nodes.push(node('d', 'D'));
    graph.edges.push(edge('e5', 'a', 'd'));
    expect(findRelatedNodes(graph, 'a').map(item => item.label)).toEqual(['C', 'first B', 'D']);
    expect(getConnectedEvidence(graph, 'a').map(item => item.id)).toEqual(
      referenceFindRelatedNodes(graph, 'a', { nodeTypes: EVIDENCE_NODE_TYPES, direction: 'both', maxDepth: 2 }).map(item => item.id),
    );
  });
});
