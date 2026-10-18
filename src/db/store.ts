import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import { GridFSBucket, MongoClient, type Collection, type Db, type ObjectId } from 'mongodb';
import type { CastDoc, ChunkDoc, ContextDoc, EmbeddingDoc, QaDoc } from '../domain.js';
import type { Chunk } from '../ingest/chunking.js';

/** Intermediate data (source chunks, notes, ingest context) is only needed while a cast runs. */
const SCRATCH_TTL_SECONDS = 7 * 24 * 60 * 60;

export type CastSummary = Pick<CastDoc, '_id' | 'kind' | 'repo' | 'status' | 'stage' | 'progress' | 'createdAt' | 'completedAt'> & {
  report?: { title?: string };
};

export class Store {
  readonly casts: Collection<CastDoc>;
  readonly chunks: Collection<ChunkDoc>;
  readonly contexts: Collection<ContextDoc>;
  readonly embeddings: Collection<EmbeddingDoc>;
  readonly qa: Collection<QaDoc>;
  readonly audio: GridFSBucket;

  private constructor(
    private readonly client: MongoClient,
    db: Db,
  ) {
    this.casts = db.collection<CastDoc>('casts');
    this.chunks = db.collection<ChunkDoc>('chunks');
    this.contexts = db.collection<ContextDoc>('contexts');
    this.embeddings = db.collection<EmbeddingDoc>('embeddings');
    this.qa = db.collection<QaDoc>('qa');
    this.audio = new GridFSBucket(db, { bucketName: 'audio' });
  }

  static async connect(uri: string, dbName: string): Promise<Store> {
    const client = new MongoClient(uri, { appName: 'codestream', ignoreUndefined: true });
    await client.connect();
    const store = new Store(client, client.db(dbName));
    await store.ensureIndexes();
    return store;
  }

  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.casts.createIndex({ createdAt: -1 }),
      this.chunks.createIndex({ castId: 1, index: 1 }),
      this.chunks.createIndex({ createdAt: 1 }, { expireAfterSeconds: SCRATCH_TTL_SECONDS }),
      this.contexts.createIndex({ createdAt: 1 }, { expireAfterSeconds: SCRATCH_TTL_SECONDS }),
      // Embeddings are rebuilt by replaceEmbeddings on each cast run; expire them with the same
      // TTL as the other scratch data so they do not accumulate for abandoned or deleted casts.
      this.embeddings.createIndex({ castId: 1, index: 1 }),
      this.embeddings.createIndex({ createdAt: 1 }, { expireAfterSeconds: SCRATCH_TTL_SECONDS }),
      this.qa.createIndex({ castId: 1, createdAt: -1 }),
    ]);
  }

  close(): Promise<void> {
    return this.client.close();
  }

  // ------------------------------------------------------------------ casts

  async insertCast(cast: CastDoc): Promise<void> {
    await this.casts.insertOne(cast);
  }

  getCast(id: string, ownerId?: number): Promise<CastDoc | null> {
    return this.casts.findOne(ownerId === undefined ? { _id: id } : { _id: id, 'owner.id': ownerId });
  }

  listCasts(limit: number, ownerId?: number): Promise<CastSummary[]> {
    return this.casts
      .find(ownerId === undefined ? {} : { 'owner.id': ownerId }, { projection: { kind: 1, repo: 1, status: 1, stage: 1, progress: 1, createdAt: 1, completedAt: 1, 'report.title': 1 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray() as Promise<CastSummary[]>;
  }

  async updateCast(id: string, set: Partial<Omit<CastDoc, '_id'>>, unset: Array<keyof CastDoc> = []): Promise<void> {
    await this.casts.updateOne(
      { _id: id },
      {
        $set: { ...set, updatedAt: new Date() },
        ...(unset.length ? { $unset: Object.fromEntries(unset.map((key) => [key, ''])) } : {}),
      },
    );
  }

  async addWarning(id: string, warning: string): Promise<void> {
    await this.casts.updateOne({ _id: id }, { $addToSet: { warnings: warning }, $set: { updatedAt: new Date() } });
  }

  // ----------------------------------------------------------------- ingest

  /** Store the chunks and context of a cast, replacing anything left by an earlier attempt. */
  async replaceIngest(castId: string, context: ContextDoc, chunks: Chunk[]): Promise<void> {
    const createdAt = new Date();
    await this.chunks.deleteMany({ castId });
    if (chunks.length > 0) {
      await this.chunks.insertMany(
        chunks.map((chunk) => ({
          _id: `${castId}:${chunk.index}`,
          castId,
          index: chunk.index,
          refs: chunk.refs,
          content: chunk.content,
          createdAt,
        })),
      );
    }
    await this.contexts.replaceOne({ _id: castId }, context, { upsert: true });
  }

  getChunk(castId: string, index: number): Promise<ChunkDoc | null> {
    return this.chunks.findOne({ _id: `${castId}:${index}` });
  }

  async saveChunkNotes(castId: string, index: number, notes: string): Promise<void> {
    await this.chunks.updateOne({ _id: `${castId}:${index}` }, { $set: { notes } });
  }

  countSummarized(castId: string): Promise<number> {
    return this.chunks.countDocuments({ castId, notes: { $exists: true } });
  }

  /** Chunk notes in order, without the (large) source content. */
  listNotes(castId: string): Promise<Array<Pick<ChunkDoc, 'index' | 'refs' | 'notes'>>> {
    return this.chunks.find({ castId }, { projection: { index: 1, refs: 1, notes: 1 } }).sort({ index: 1 }).toArray();
  }

  /** Chunk source content in order; the input for building a cast's Q&A embedding index. */
  listChunks(castId: string): Promise<Array<Pick<ChunkDoc, 'index' | 'refs' | 'content' | 'notes'>>> {
    return this.chunks.find({ castId }, { projection: { index: 1, refs: 1, content: 1, notes: 1 } }).sort({ index: 1 }).toArray();
  }

  getContext(castId: string): Promise<ContextDoc | null> {
    return this.contexts.findOne({ _id: castId });
  }

  // -------------------------------------------------------------- embeddings

  /** Store the vector index of a cast, replacing anything left by an earlier attempt. */
  async replaceEmbeddings(castId: string, docs: Array<Omit<EmbeddingDoc, '_id' | 'createdAt'>>): Promise<void> {
    const createdAt = new Date();
    await this.embeddings.deleteMany({ castId });
    if (docs.length > 0) {
      await this.embeddings.insertMany(
        docs.map((doc, i) => ({ ...doc, _id: `${castId}:emb:${doc.index}:${i}`, createdAt })),
      );
    }
  }

  getEmbeddings(castId: string): Promise<EmbeddingDoc[]> {
    return this.embeddings.find({ castId }).sort({ index: 1 }).toArray();
  }

  // ----------------------------------------------------------------- history

  async insertQa(doc: Omit<QaDoc, '_id' | 'createdAt'>): Promise<QaDoc> {
    const full: QaDoc = { ...doc, _id: randomBytes(9).toString('base64url'), createdAt: new Date() };
    await this.qa.insertOne(full);
    return full;
  }

  listQa(castId: string, limit = 50): Promise<QaDoc[]> {
    return this.qa.find({ castId }).sort({ createdAt: 1 }).limit(limit).toArray();
  }

  // ------------------------------------------------------------------ audio

  async saveAudio(castId: string, data: Buffer, contentType: string): Promise<{ fileId: ObjectId; bytes: number }> {
    // A retried activity may have uploaded a file already; keep exactly one per cast.
    for (const file of await this.audio.find({ 'metadata.castId': castId }).toArray()) {
      await this.audio.delete(file._id);
    }
    const upload = this.audio.openUploadStream(`${castId}.mp3`, { metadata: { castId, contentType } });
    await pipeline(Readable.from([data]), upload);
    return { fileId: upload.id, bytes: data.length };
  }

  /** Stream stored audio; `end` is exclusive, as in GridFS. */
  openAudio(fileId: ObjectId, range?: { start: number; end: number }): Readable {
    return this.audio.openDownloadStream(fileId, range);
  }
}
