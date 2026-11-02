import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { startShop, stop, seedMedicine, serverStock, addUser, type Shop } from './helpers.ts';
import { makeHead, joinHead, syncWithHead, stockAll, sendTransfer, receiveTransfer, allTransfers, branchReport, branchStatus, leaveHead, HEAD } from '../server/branches.ts';
import { getRow, allRows, putRow } from '../server/db.ts';
import { getIdentity } from '../server/identity.ts';
import { pairingPayload } from '../server/tunnel.ts';
import { applyOp, serverClock } from '../server/ops.ts';
import { uuid, isoDate } from '../shared/util.ts';
import { summarize } from '../shared/accounting.ts';
import type { Medicine, LedgerEntry, Invoice, Patient, Batch } from '../shared/types.ts';

const codeOf = (S: Shop) => { const id = getIdentity(S.db)!; return 'pharmadesk:' + Buffer.from(JSON.stringify(pairingPayload(id.serverId, id.name, { lan: [S.url], tailscale: null, cloudflare: null }))).toString('base64url'); };

describe('Branches', () => {
  let H: Shop, B: Shop, C: Shop;
  beforeEach(async () => { H = await startShop('Head'); B = await startShop('Gulberg'); C = await startShop('Saddar'); });
  afterEach(async () => { await stop(H); await stop(B); await stop(C); });
  const connect = async (S: Shop, share = false, name = 'Branch') => {
    makeHead(H.db, share);
    await joinHead(S.db, { code: codeOf(H), pin: getIdentity(H.db)!.pin, branchName: name });
  };

  it('a wrong code or PIN cannot connect', async () => {
    makeHead(H.db, false);
    await expect(joinHead(B.db, { code: 'rubbish', pin: '1' })).rejects.toThrow(/not a head office code/);
    await expect(joinHead(B.db, { code: codeOf(H), pin: '000000' })).rejects.toThrow();
    expect(branchStatus(B.db).role).toBe('none');
  });

  it('a branch cannot join a PC that is not a head office', async () => {
    await expect(joinHead(B.db, { code: codeOf(H), pin: getIdentity(H.db)!.pin })).rejects.toThrow(/head office/);
    expect(branchStatus(B.db).role).toBe('none');
  });

  it('medicines made anywhere reach everywhere, but stock stays in its own branch', async () => {
    const { med } = seedMedicine(H.db, 'Panadol', 'Paracetamol', 270, [{ batchNo: 'H1', qty: 50, expiresInDays: 300 }]);
    const b = seedMedicine(B.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 20, expiresInDays: 300 }]);
    await connect(B); await connect(C);
    await syncWithHead(B.db); await syncWithHead(C.db); await syncWithHead(B.db);
    expect(getRow<Medicine>(B.db, 'medicines', med.id)?.name).toBe('Panadol');
    expect(getRow<Medicine>(H.db, 'medicines', b.med.id)?.name).toBe('Brufen');
    expect(getRow<Medicine>(C.db, 'medicines', b.med.id)?.name).toBe('Brufen');
    expect(serverStock(B.db, med.id)).toBe(0);
    expect(serverStock(H.db, b.med.id)).toBe(0);
    const list = stockAll(H.db);
    expect(list.find(x => x.id === HEAD)!.stock[med.id]).toBe(50);
    expect(list.find(x => x.name === 'Branch')!.stock[b.med.id]).toBe(20);
    expect(stockAll(C.db).find(x => x.id === HEAD)!.stock[med.id]).toBe(50);
  });

  it('syncing again changes nothing (rows never bounce)', async () => {
    seedMedicine(H.db, 'Panadol', 'Paracetamol', 270, []);
    await connect(B);
    await syncWithHead(B.db); await syncWithHead(B.db);
    const rev = (S: Shop) => (S.db.prepare(`SELECT value FROM meta WHERE key = 'rev'`).get() as { value: string }).value;
    const a = rev(H), c = rev(B);
    await syncWithHead(B.db); await syncWithHead(B.db);
    expect(rev(H)).toBe(a); expect(rev(B)).toBe(c);
  });

  it('the newest edit of a medicine wins on both sides', async () => {
    const { med } = seedMedicine(H.db, 'Panadol', 'Paracetamol', 270, []);
    await connect(B); await syncWithHead(B.db);
    putRow(B.db, 'medicines', { ...getRow<Medicine>(B.db, 'medicines', med.id)!, salePrice: 999 } as Medicine, serverClock.tick());
    await syncWithHead(B.db);
    expect(getRow<Medicine>(H.db, 'medicines', med.id)?.salePrice).toBe(999);
  });

  it('a transfer leaves one branch, arrives once in the other, nothing lost or doubled', async () => {
    const { med, batches: [b1] } = seedMedicine(H.db, 'Panadol', 'Paracetamol', 270, [{ batchNo: 'H1', qty: 50, expiresInDays: 300 }]);
    await connect(B, false, 'Gulberg'); await syncWithHead(B.db);
    const to = branchStatus(H.db).branches[0].id;
    const t = sendTransfer(H.db, H.owner, { to, lines: [{ batchId: b1.id, qty: 10 }] });
    expect(serverStock(H.db, med.id)).toBe(40);
    await syncWithHead(B.db);
    expect(serverStock(B.db, med.id)).toBe(0); // not until someone confirms it
    expect(allTransfers(B.db)[0].status).toBe('sent');
    receiveTransfer(B.db, B.owner, t.id);
    expect(serverStock(B.db, med.id)).toBe(10);
    expect(() => receiveTransfer(B.db, B.owner, t.id)).toThrow(/already/);
    await syncWithHead(B.db);
    expect(allTransfers(H.db)[0].status).toBe('received');
    await syncWithHead(B.db);
    expect(allTransfers(B.db)[0].status).toBe('received');
    expect(serverStock(B.db, med.id)).toBe(10); expect(serverStock(H.db, med.id)).toBe(40);
  });

  it('a branch can send to head office, with bad transfers refused and stock untouched', async () => {
    const { med, batches: [b1] } = seedMedicine(B.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 5, expiresInDays: 300 }]);
    const old = seedMedicine(B.db, 'Old', 'Old', 100, [{ batchNo: 'X', qty: 5, expiresInDays: -2 }]);
    await connect(B); await syncWithHead(B.db);
    expect(() => sendTransfer(B.db, B.owner, { to: HEAD, lines: [{ batchId: b1.id, qty: 6 }] })).toThrow(/Not enough/);
    expect(() => sendTransfer(B.db, B.owner, { to: HEAD, lines: [{ batchId: b1.id, qty: 1.5 }] })).toThrow(/whole/);
    expect(() => sendTransfer(B.db, B.owner, { to: HEAD, lines: [{ batchId: old.batches[0].id, qty: 1 }] })).toThrow(/Expired/);
    expect(() => sendTransfer(B.db, B.owner, { to: 'nobody', lines: [{ batchId: b1.id, qty: 1 }] })).toThrow(/not connected/);
    expect(serverStock(B.db, med.id)).toBe(5);
    const t = sendTransfer(B.db, B.owner, { to: HEAD, lines: [{ batchId: b1.id, qty: 2 }] });
    await syncWithHead(B.db);
    receiveTransfer(H.db, H.owner, t.id);
    expect(serverStock(H.db, med.id)).toBe(2); expect(serverStock(B.db, med.id)).toBe(3);
  });

  it('when the link is down the branch keeps working and catches up later', async () => {
    const { batches: [b1] } = seedMedicine(B.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 5, expiresInDays: 300 }]);
    await connect(B);
    await syncWithHead(B.db);
    const port = H.port;
    await stop(H);
    await expect(syncWithHead(B.db, (async () => { throw new TypeError('down'); }) as never)).rejects.toThrow();
    const t = sendTransfer(B.db, B.owner, { to: HEAD, lines: [{ batchId: b1.id, qty: 1 }] });
    const { listen } = await import('./helpers.ts');
    await listen(H, port);
    await syncWithHead(B.db);
    expect(allTransfers(H.db).map(x => x.id)).toContain(t.id);
  });

  it('customers and their accounts are shared only when the owner chooses', async () => {
    const pat: Patient = { id: uuid(), name: 'Ali', hlc: serverClock.tick() };
    putRow(B.db, 'patients', pat, serverClock.tick());
    const led = (id: string): LedgerEntry => ({ id, partyType: 'patient', partyId: pat.id, date: isoDate(), debit: 1000, credit: 0, ref: 'S', hlc: serverClock.tick() });
    putRow(B.db, 'ledger', led('L1'), serverClock.tick());
    await connect(B, false); await syncWithHead(B.db);
    expect(getRow(H.db, 'patients', pat.id)).toBeNull();
    expect(getRow(H.db, 'ledger', 'L1')).toBeNull();
    makeHead(H.db, true);
    await syncWithHead(B.db); // learns the owner's choice
    await syncWithHead(B.db);
    expect(getRow<Patient>(H.db, 'patients', pat.id)?.name).toBe('Ali');
    const onHead = getRow<LedgerEntry & { foreign?: boolean }>(H.db, 'ledger', 'L1')!;
    expect(onHead.debit).toBe(1000); expect(onHead.foreign).toBe(true);
    // It does not bounce back as foreign onto the branch that made it.
    await syncWithHead(B.db);
    expect(getRow<LedgerEntry & { foreign?: boolean }>(B.db, 'ledger', 'L1')!.foreign).toBeUndefined();
  });

  it('a payment made at another branch is not counted twice in the cash figures', () => {
    const entries: LedgerEntry[] = [{ id: 'a', partyType: 'patient', partyId: 'p', date: '2026-01-05', debit: 0, credit: 500, ref: 'PAYMENT' },
      { id: 'b', partyType: 'patient', partyId: 'p', date: '2026-01-05', debit: 0, credit: 700, ref: 'PAYMENT', foreign: true } as LedgerEntry];
    const s = summarize({ invoices: [], invoiceItems: [], refunds: [], purchases: [], expenses: [], ledger: entries }, '2026-01-01', '2026-01-31');
    expect(s.totals.cashIn).toBe(500);
  });

  it('head office report adds up every branch without mixing their stock', async () => {
    const { med, batches: [b1] } = seedMedicine(B.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 10, expiresInDays: 300 }]);
    const inv: Invoice = { id: uuid(), number: 'B-1', cashierId: B.owner.id, createdAt: new Date().toISOString(), status: 'paid', gross: 500, discount: 0, tax: 0, total: 500, paid: 500, change: 0, payMethod: 'cash', deviceId: 'd' };
    expect(applyOp(B.db, { id: uuid(), kind: 'sale', strict: false, deviceId: 'd', userId: B.owner.id, createdAt: '', rows: [{ tbl: 'invoices', row: inv }], deltas: [{ batchId: b1.id, medicineId: med.id, delta: -1 }] }).ok).toBe(true);
    await connect(B, false, 'Gulberg'); await syncWithHead(B.db);
    const r = branchReport(H.db, isoDate(), isoDate());
    expect(r.rows.find(x => x.name === 'Gulberg')!.netSales).toBe(500);
    expect(r.rows.find(x => x.id === HEAD)!.netSales).toBe(0);
    expect(r.total.netSales).toBe(500);
    expect(serverStock(H.db, med.id)).toBe(0);
    expect(allRows<Batch>(H.db, 'batches').length).toBe(0);
    expect(allRows<Invoice>(H.db, 'invoices').length).toBe(0);
  });

  it('only a user with the permission can use branch screens', async () => {
    const c = addUser(H, 'cashier');
    const id = getIdentity(H.db)!;
    const token = (await request(H.app).post('/api/pair').send({ sid: id.serverId, pin: id.pin })).body.token;
    const auth = { authorization: `Bearer ${token}` };
    const sess = (await request(H.app).post('/api/login').set(auth).send({ username: c.username, pin: '222222' })).body.sessionId;
    expect((await request(H.app).get('/api/branch/report?from=2026-01-01&to=2026-01-02').set(auth).set('x-session', sess)).status).toBe(403);
    expect((await request(H.app).post('/local/branch/head').send({ share: false })).status).toBe(200);
    expect((await request(H.app).post('/local/branch/head').set('x-forwarded-for', '1.1.1.1').send({})).status).toBe(403);
  });

  it('disconnecting returns a branch to working alone', async () => {
    await connect(B); leaveHead(B.db);
    expect(branchStatus(B.db).role).toBe('none');
  });
});

describe('Branches are the owner\'s choice', () => {
  it('are off unless the owner switches them on, and nothing connects by itself', async () => {
    const { moduleOn } = await import('../shared/permissions.ts');
    expect(moduleOn('branches', null)).toBe(false);
    expect(moduleOn('branches', {})).toBe(false);
    expect(moduleOn('branches', { branchesOn: true })).toBe(true);
    expect(moduleOn('pos', null)).toBe(true);
    const S = await startShop();
    try {
      expect(branchStatus(S.db).role).toBe('none');
      let called = false;
      expect(await syncWithHead(S.db, (async () => { called = true; }) as never)).toBe(false);
      expect(called).toBe(false);
    } finally { await stop(S); }
  });
});
