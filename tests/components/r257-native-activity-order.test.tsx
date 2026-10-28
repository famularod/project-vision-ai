import { fireEvent, render } from '@testing-library/react-native';

import {
  ProjectItemDetailsEditor,
  ProjectItemNextAction,
  ProjectItemSummary,
  ProjectItemTypeBadge,
} from '../../components/project-item-details';
import type { ScheduleItem } from '../../types';

const ITEM: ScheduleItem = {
  id: 'issue-1',
  itemType: 'Issue',
  projectName: '2375 Compliance Project',
  locationName: 'Canopy C',
  taskName: 'Missing storefront glass',
  startDate: '',
  finishDate: '2026-07-24',
  milestone: '',
  owner: 'David',
  contractor: 'Glazing contractor',
  percentComplete: 0,
  priority: 'High',
  status: 'Waiting',
  notes: 'Material has not arrived.',
  nextAction: 'Confirm delivery date.',
  activity: [],
  createdAt: '2026-07-22T18:00:00.000Z',
};


it('2.57 native Activity shows latest three by time without mutating stored records',()=>{
 const activity=[['latest','2026-10-17T12:00:00Z'],['old','2026-09-01T12:00:00Z'],['middle','2026-10-01T12:00:00Z'],['newer','2026-10-15T12:00:00Z']].map(([message,createdAt])=>({id:message,message,createdAt,author:'PM'}));const item={...ITEM,activity};const before=JSON.stringify(item);const v=render(<ProjectItemDetailsEditor item={item} onUpdate={jest.fn()}/>);const shown=v.getAllByText(/^(latest|old|middle|newer)$/).map(n=>n.props.children);expect(shown).toEqual(['latest','newer','middle']);expect(JSON.stringify(item)).toBe(before);
});
