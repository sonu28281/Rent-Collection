// Drop-in replacement for `firebase/firestore` that transparently counts the
// billable operations the app performs, so the sidebar quota meter can show an
// estimate of today's usage. Re-exports every Firestore helper the app uses;
// only getDocs/getDoc (reads) and addDoc/setDoc/updateDoc/deleteDoc (writes) are
// wrapped to increment the counter. Everything else is a pass-through.
//
// App code imports from THIS module instead of 'firebase/firestore'. This module
// keeps the real 'firebase/firestore' import, so there is no circular alias.

import {
  addDoc as _addDoc,
  collection as _collection,
  deleteDoc as _deleteDoc,
  doc as _doc,
  getDoc as _getDoc,
  getDocs as _getDocs,
  getFirestore as _getFirestore,
  limit as _limit,
  onSnapshot as _onSnapshot,
  orderBy as _orderBy,
  query as _query,
  serverTimestamp as _serverTimestamp,
  setDoc as _setDoc,
  updateDoc as _updateDoc,
  where as _where,
  writeBatch as _writeBatch,
} from 'firebase/firestore';
import { recordReads, recordWrites } from './quotaMeter';

// ── Pass-throughs (not billable on their own) ──────────────────────────────
export const collection = _collection;
export const doc = _doc;
export const getFirestore = _getFirestore;
export const limit = _limit;
export const onSnapshot = _onSnapshot; // real-time listener; not counted (admin-only)
export const orderBy = _orderBy;
export const query = _query;
export const serverTimestamp = _serverTimestamp;
export const where = _where;
export const writeBatch = _writeBatch; // batch writes are not counted (rare, admin-only)

// ── Reads ──────────────────────────────────────────────────────────────────
export const getDocs = async (...args) => {
  const snap = await _getDocs(...args);
  // Firestore bills a minimum of 1 read per query, even when it returns nothing.
  recordReads(Math.max(1, snap?.size ?? 0));
  return snap;
};

export const getDoc = async (...args) => {
  const snap = await _getDoc(...args);
  recordReads(1);
  return snap;
};

// ── Writes ──────────────────────────────────────────────────────────────────
export const addDoc = async (...args) => {
  const res = await _addDoc(...args);
  recordWrites(1);
  return res;
};

export const setDoc = async (...args) => {
  const res = await _setDoc(...args);
  recordWrites(1);
  return res;
};

export const updateDoc = async (...args) => {
  const res = await _updateDoc(...args);
  recordWrites(1);
  return res;
};

export const deleteDoc = async (...args) => {
  const res = await _deleteDoc(...args);
  recordWrites(1);
  return res;
};
