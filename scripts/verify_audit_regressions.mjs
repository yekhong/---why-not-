import assert from 'node:assert/strict';

// The in-memory server is intentional: these tests exercise the same HTTP routes
// used by local demos, without touching a production database.
process.env.VERCEL = '1';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const { default: app } = await import('../server.ts');
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function request(path, method = 'GET', body, cookie) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

async function signup(label) {
  const result = await request('/api/auth/signup', 'POST', {
    loginId: `audit${label}${Date.now()}`.slice(0, 30),
    password: 'Auditpass123', nickname: label.slice(0, 6)
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result;
}

try {
  const host = await signup('host');
  const voter = await signup('voter');
  const participant = await signup('peer');
  const created = await request('/api/rooms', 'POST', {
    title: '감사 회의실', maxParticipants: 2, decisionMode: 'QUICK',
    externalVotersEnabled: true, requiredVoterCount: 1
  }, host.cookie);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const roomId = created.data.id;
  const voterInvite = await request(`/api/rooms/${roomId}/invites`, 'POST', { inviteType: 'VOTER' }, host.cookie);
  assert.equal(voterInvite.status, 200);
  const joinedVoter = await request(`/api/invites/${voterInvite.data.invite.inviteToken}/join`, 'POST', {}, voter.cookie);
  assert.equal(joinedVoter.status, 200);
  assert.equal(joinedVoter.data.role, 'VOTER', 'voter invite must never grant participant privileges');
  assert.equal(joinedVoter.data.waiting, true);
  const voterRoom = await request(`/api/rooms/${roomId}`, 'GET', undefined, voter.cookie);
  assert.equal(voterRoom.data.myParticipantRole, 'VOTER');
  assert.equal(voterRoom.data.waitingForFinalVote, true);
  const forbiddenIdea = await request(`/api/rooms/${roomId}/ideas`, 'POST', { title: '외부 투표자의 아이디어' }, voter.cookie);
  assert.notEqual(forbiddenIdea.status, 201);

  const participantInvite = await request(`/api/rooms/${roomId}/invites`, 'POST', { inviteType: 'PARTICIPANT' }, host.cookie);
  assert.equal(participantInvite.status, 200);
  const joinedParticipant = await request(`/api/invites/${participantInvite.data.invite.inviteToken}/join`, 'POST', { nickname: '동료' }, participant.cookie);
  assert.equal(joinedParticipant.status, 200, JSON.stringify(joinedParticipant.data));
  const switchedRole = await request(`/api/invites/${participantInvite.data.invite.inviteToken}/join`, 'POST', { nickname: '투표자' }, voter.cookie);
  assert.equal(switchedRole.status, 409, 'a waiting voter must not switch roles through a participant invite');
  const registeredVoter = await signup('extra');
  const fullVoterSeat = await request(`/api/invites/${voterInvite.data.invite.inviteToken}/join`, 'POST', {}, registeredVoter.cookie);
  assert.equal(fullVoterSeat.status, 409, 'the voter quota must be enforced independently of participant capacity');

  const hostIdea = await request(`/api/rooms/${roomId}/ideas`, 'POST', { title: '첫 번째 제안', description: '설명' }, host.cookie);
  const peerIdea = await request(`/api/rooms/${roomId}/ideas`, 'POST', { title: '두 번째 제안', description: '설명' }, participant.cookie);
  assert.equal(hostIdea.status, 201);
  assert.equal(peerIdea.status, 201);
  assert.equal((await request(`/api/rooms/${roomId}/ideas/complete`, 'POST', {}, host.cookie)).status, 200);
  assert.equal((await request(`/api/rooms/${roomId}/ideas/complete`, 'POST', {}, participant.cookie)).status, 200);
  const startedVote = await request(`/api/rooms/${roomId}/quick/start-vote`, 'POST', {}, host.cookie);
  assert.equal(startedVote.status, 200, JSON.stringify(startedVote.data));
  const activatedVoter = await request(`/api/rooms/${roomId}`, 'GET', undefined, voter.cookie);
  assert.equal(activatedVoter.data.myParticipantRole, 'VOTER');
  assert.notEqual(activatedVoter.data.waitingForFinalVote, true);
  assert.equal((await request(`/api/rooms/${roomId}/star-vote`, 'POST', {
    selectedIdeaIds: [hostIdea.data.id, hostIdea.data.id, peerIdea.data.id]
  }, voter.cookie)).status, 200, 'the voter may cast a final ballot after roster lock');

  const archived = await request(`/api/rooms/${roomId}/hide`, 'POST', {}, host.cookie);
  assert.equal(archived.status, 200);
  const archivedList = await request('/api/rooms', 'GET', undefined, host.cookie);
  assert.equal(archivedList.data.find(room => room.id === roomId)?.isHidden, true, 'archive should persist in the local room list');
  const otherUserList = await request('/api/rooms', 'GET', undefined, participant.cookie);
  assert.equal(otherUserList.data.find(room => room.id === roomId)?.isHidden, false,
    'archiving a room must not hide it for another participant');
  const restored = await request(`/api/rooms/${roomId}/hide`, 'DELETE', undefined, host.cookie);
  assert.equal(restored.status, 200);
  const restoredList = await request('/api/rooms', 'GET', undefined, host.cookie);
  assert.equal(restoredList.data.find(room => room.id === roomId)?.isHidden, false);

  const rateId = `auditlimit${Date.now()}`;
  for (let i = 0; i < 5; i++) {
    const invalid = await request('/api/auth/register', 'POST', { loginId: rateId });
    assert.equal(invalid.status, 400);
  }
  const checkId = await request('/api/auth/check-id', 'POST', { loginId: rateId });
  assert.equal(checkId.status, 200, 'register alias should consume one attempt per request');
  console.log('PASS: local voter isolation, participant invite, archive/restore and register alias rate limit');
} finally {
  server.close();
}
