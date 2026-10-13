import { askECOSProjectQuestion, ecosAskCanRetry } from '../../services/ECOSProjectQuestion';

// Build 231 E1 item 3: when the server itself gives up on a question (the
// live gateway answers 504 "agent_gateway_timed_out" after 125 s), the app
// said "Ask ECOS could not complete the question" instead of saying it ran
// out of time.

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '55555555-5555-4555-8555-555555555555'),
}));

const RAN_OUT_OF_TIME =
  'ECOS ran out of time before it finished this question, so it stopped. ' +
  'No answer has been verified. Your question is still here — try again.';

function askAgainst(response: Response) {
  return askECOSProjectQuestion({
    client: {
      auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null }) },
      functions: { invoke: jest.fn().mockResolvedValue({ data: null, error: new Error('request failed'), response }) },
    } as never,
    projectId: 'project-2375',
    projectName: '2375 Compliance Project',
    question: 'How many square feet is Canopy A?',
  });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('E1 item 3: the server ran out of time', () => {
  it('says so when the gateway gives up (504 agent_gateway_timed_out), and offers Try Again', async () => {
    const error = await askAgainst(json(504, { error: 'agent_gateway_timed_out' })).catch(caught => caught);
    expect(error).toMatchObject({ code: 'agent_gateway_timed_out', message: RAN_OUT_OF_TIME });
    expect(ecosAskCanRetry(error)).toBe(true);
  });

  it('says so for a 504 with no readable body (the hosting platform cut the request off)', async () => {
    await expect(askAgainst(new Response('upstream request timeout', { status: 504 })))
      .rejects.toMatchObject({ code: 'request_failed', message: RAN_OUT_OF_TIME });
  });

  it('says so for any other code the server names as a time-out', async () => {
    await expect(askAgainst(json(503, { error: 'dependency_timed_out' })))
      .rejects.toMatchObject({ code: 'dependency_timed_out', message: RAN_OUT_OF_TIME });
  });

  // Guards: these already hold on 594a71d.
  it('keeps the answer engine\'s own time-limit wording', async () => {
    await expect(askAgainst(json(503, { error: 'answer_timed_out' }))).rejects.toMatchObject({
      message: 'ECOS reached the time limit before it could finish checking the answer. Please try again; no answer has been verified.',
    });
  });

  it('does not call an unavailable gateway a time-out', async () => {
    await expect(askAgainst(json(503, { error: 'agent_gateway_unavailable' })))
      .rejects.toMatchObject({ message: 'Ask ECOS is temporarily unavailable. Try again shortly.' });
    await expect(askAgainst(json(500, { error: 'internal_error' })))
      .rejects.toMatchObject({ message: 'Ask ECOS could not complete the question. Try again shortly.' });
  });
});
