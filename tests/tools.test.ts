import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startShop, stop, newDevice, seedMedicine, serverStock, addUser, type Shop } from './helpers.ts';
import { login } from '../client/core/auth.ts';
import { adjustStock, returnToSupplier, setOpeningBalance, recordPayment, partyBalance, saveRecord } from '../client/core/inventory.ts';
import { getRow, allRows } from '../server/db.ts';
import { applyOp } from '../server/ops.ts';
import { expiryLoss, deadStock, profitByMedicine, whatsappLink } from '../shared/reports.ts';
import { setBackupFolder, copyToFolder, backupFolderStatus, restoreBackup } from '../server/backup.ts';
import { openDb } from '../server/db.ts';
import { uuid } from '../shared/util.ts';
import type { Batch, Invoice, InvoiceItem, LedgerEntry, Medicine, Refund, Supplier } from '../shared/types.ts';
import { putRow } from '../server/db.ts';
import { serverClock } from '../server/ops.ts';

let S: Shop | null = null;
afterEach(async () => { if (S) await stop(S); S = null; });

describe('Stock tools on a real device and server', () => {
  it('a supplier return takes stock out, comes off what we owe, and matches on the server', async () => {
    S = await startShop();
    const { med, batches: [b] } = seedMedicine(S.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 10, expiresInDays: 200 }]);
    const sup: Supplier = { id: uuid(), name: 'Getz', hlc: serverClock.tick() };
    putRow(S.db, 'suppliers', sup, serverClock.tick());
    const d = await newDevice(S); await login(d.ctx, 'owner', '111111', d.client); await d.sync.syncNow();
    await expect(returnToSupplier(d.ctx, sup.id, b.id, 11, 'x')).rejects.toThrow(/Only 10/);
    await expect(returnToSupplier(d.ctx, sup.id, b.id, 2, ' ')).rejects.toThrow(/reason/);
    await setOpeningBalance(d.ctx, 'supplier', sup.id, 5000, '2026-01-01');
    const e = await returnToSupplier(d.ctx, sup.id, b.id, 2, 'Damaged');
    expect(e.debit).toBe(2 * b.costPrice);
    await d.sync.syncNow();
    expect(serverStock(S.db, med.id)).toBe(8);
    expect(getRow<LedgerEntry>(S.db, 'ledger', e.id)?.ref).toMatch(/^PRET-/);
    expect(await partyBalance(d.ctx, 'supplier', sup.id)).toBe(5000 - e.debit);
  });

  it('a user without the permission cannot return stock, on the device or the server', async () => {
    S = await startShop();
    const c = addUser(S, 'cashier');
    const { med, batches: [b] } = seedMedicine(S.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 10, expiresInDays: 200 }]);
    const d = await newDevice(S); await login(d.ctx, 'cashier', '222222', d.client);
    await expect(returnToSupplier(d.ctx, 's', b.id, 1, 'x')).rejects.toThrow();
    const row = { id: uuid(), partyType: 'supplier', partyId: 's', date: '2026-01-01', debit: 400, credit: 0, ref: 'PRET-1' } as LedgerEntry;
    expect(applyOp(S.db, { id: uuid(), kind: 'stock', strict: false, deviceId: 'd', userId: c.id, createdAt: '', rows: [{ tbl: 'ledger', row }], deltas: [{ batchId: b.id, medicineId: med.id, delta: -1 }] }).ok).toBe(false);
    expect(serverStock(S.db, med.id)).toBe(10);
  });

  it('a stock op cannot use the return shape to add other ledger lines', async () => {
    S = await startShop();
    const row = { id: uuid(), partyType: 'patient', partyId: 'p', date: '2026-01-01', debit: 0, credit: 9999, ref: 'PAYMENT' } as LedgerEntry;
    expect(applyOp(S.db, { id: uuid(), kind: 'stock', strict: false, deviceId: 'd', userId: S.owner.id, createdAt: '', rows: [{ tbl: 'ledger', row }], deltas: [] }).ok).toBe(false);
  });

  it('stock count corrects the batch and a closing syncs to the server', async () => {
    S = await startShop();
    const { med, batches: [b] } = seedMedicine(S.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 10, expiresInDays: 200 }]);
    const d = await newDevice(S); await login(d.ctx, 'owner', '111111', d.client); await d.sync.syncNow();
    await adjustStock(d.ctx, b.id, -3, 'Stock count');
    const c = await saveRecord(d.ctx, 'closings', { date: '2026-01-01', expected: 1000, counted: 900, difference: -100, at: new Date().toISOString() });
    await d.sync.syncNow();
    expect(serverStock(S.db, med.id)).toBe(7);
    expect(allRows(S.db, 'closings').map(x => x.id)).toContain(c.id);
  });

  it('payment method reaches the server', async () => {
    S = await startShop();
    const d = await newDevice(S); await login(d.ctx, 'owner', '111111', d.client);
    const e = await recordPayment(d.ctx, 'patient', 'p1', 500, 'x', 'bank');
    await d.sync.syncNow();
    expect(getRow<LedgerEntry>(S.db, 'ledger', e.id)?.method).toBe('bank');
  });
});

describe('Reports', () => {
  const med = (id: string): Medicine => ({ id, name: id, generic: '', salePrice: 100 });
  const bat = (id: string, medicineId: string, qty: number, expiryDate: string, costPrice = 50): Batch => ({ id, medicineId, batchNo: id, qty, expiryDate, costPrice });
  const inv = (id: string, day: string, status: Invoice['status'] = 'paid'): Invoice => ({ id, number: id, cashierId: 'u', createdAt: `${day}T12:00:00`, status, gross: 0, discount: 0, tax: 0, total: 0, paid: 0, change: 0, payMethod: 'cash', deviceId: 'd' });
  const item = (invoiceId: string, medicineId: string, qty: number, total: number, cost: number, tax = 0): InvoiceItem => ({ id: uuid(), invoiceId, medicineId, batchId: 'b', qty, unitPrice: 0, costPrice: cost, discount: 0, taxBp: 0, tax, total });

  it('expiry loss counts only expired stock', () => {
    const r = expiryLoss([bat('a', 'm', 4, '2026-01-01'), bat('b', 'm', 9, '2030-01-01')], [med('m')], '2026-06-01');
    expect(r.total).toBe(200); expect(r.rows.length).toBe(1);
  });
  it('dead stock ignores what sold recently and what already expired', () => {
    const r = deadStock([bat('a', 'sold', 5, '2030-01-01'), bat('b', 'idle', 5, '2030-01-01'), bat('c', 'gone', 5, '2020-01-01')], [med('sold'), med('idle'), med('gone')], [inv('i', '2026-05-30')], [item('i', 'sold', 1, 100, 50)], '2026-06-01');
    expect(r.rows.map(x => x.id)).toEqual(['idle']); expect(r.total).toBe(250);
  });
  it('profit per medicine removes tax, voids and returns', () => {
    const refunds: Refund[] = [{ id: 'r', invoiceId: 'i', number: 'R', date: '2026-01-06', createdAt: '', userId: 'u', reason: 'x', method: 'cash', items: [{ itemId: 'x', medicineId: 'm', batchId: 'b', qty: 1, amount: 110, tax: 10, cost: 60 }], total: 110, tax: 10 }];
    const r = profitByMedicine([inv('i', '2026-01-05'), inv('v', '2026-01-05', 'void')], [item('i', 'm', 3, 330, 60, 30), item('v', 'm', 9, 900, 60)], refunds, [med('m')], '2026-01-01', '2026-01-31');
    expect(r.rows[0]).toMatchObject({ qty: 2, sales: 200, cost: 120, profit: 80 });
  });
  it('whatsapp link uses the country code and keeps the bill text', () => {
    expect(whatsappLink('0300-1234567', 'Total: Rs 5 & more', 'pk')).toBe('https://wa.me/923001234567?text=Total%3A%20Rs%205%20%26%20more');
    expect(whatsappLink('+971 50 123', 'x', 'ae')).toBe('https://wa.me/97150123?text=x');
    expect(whatsappLink('', 'x')).toBe('https://wa.me/?text=x');
  });
});

describe('Backup to a folder', () => {
  it('saves a locked copy, keeps 7, reports a missing drive, and restores with the PIN', async () => {
    S = await startShop();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdbk-'));
    expect(() => setBackupFolder(S!.db, dir, '000000')).toThrow(/Wrong/);
    setBackupFolder(S.db, dir, '111111');
    expect(backupFolderStatus(S.db).error).toBeNull();
    for (let i = 0; i < 9; i++) { await new Promise(r => setTimeout(r, 2)); expect(copyToFolder(S.db)).toBe(true); }
    const files = fs.readdirSync(dir);
    expect(files.length).toBe(7);
    const text = fs.readFileSync(path.join(dir, files[0]), 'utf8');
    expect(text).not.toContain('Owner');
    const fresh = openDb(':memory:');
    expect(restoreBackup(fresh, text, '111111').rows).toBeGreaterThan(0);
    fresh.close();
    fs.rmSync(dir, { recursive: true });
    expect(copyToFolder(S.db)).toBe(false);
    expect(backupFolderStatus(S.db).error).toMatch(/USB/);
    setBackupFolder(S.db, '', '');
    expect(backupFolderStatus(S.db).folder).toBeNull();
  });
});
