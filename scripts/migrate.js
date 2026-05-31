/**
 * Migrate all data from old Atlas cluster to new Atlas cluster.
 * Creates all indexes on target DB after migration.
 */

const mongoose = require('mongoose');

const OLD_URI = 'mongodb://maskiryz23_db_user:q9IBVyRejlRnp6ZB@ac-oadrxi4-shard-00-00.ebd6nrq.mongodb.net:27017,ac-oadrxi4-shard-00-01.ebd6nrq.mongodb.net:27017,ac-oadrxi4-shard-00-02.ebd6nrq.mongodb.net:27017/inspira-mailer?replicaSet=atlas-8ft5w6-shard-0&tls=true&authSource=admin';

const NEW_URI = 'mongodb://labinaraksaraai_db_user:7cSwvlQztIBD3D7V@ac-cmvywy9-shard-00-00.oyasofn.mongodb.net:27017,ac-cmvywy9-shard-00-01.oyasofn.mongodb.net:27017,ac-cmvywy9-shard-00-02.oyasofn.mongodb.net:27017/inspira-mailer?replicaSet=atlas-5kdkxd-shard-0&tls=true&authSource=admin';

// Collections to migrate (in order — respect no foreign key deps)
const COLLECTIONS = [
  'users',
  'emails',
  'activitylogs',
  'shorturls',
  'tasks',
  'signatures',
  'agreements',
  'doccounters'
];

async function migrate() {
  console.log('\n=== Inspira Mailer — Database Migration ===\n');

  // Connect both
  console.log('Menghubungkan ke database lama...');
  const oldConn = await mongoose.createConnection(OLD_URI).asPromise();
  console.log('✓ Database lama terhubung\n');

  console.log('Menghubungkan ke database baru...');
  const newConn = await mongoose.createConnection(NEW_URI).asPromise();
  console.log('✓ Database baru terhubung\n');

  const oldDb = oldConn.db;
  const newDb = newConn.db;

  let totalMigrated = 0;

  for (const col of COLLECTIONS) {
    try {
      const existing = await oldDb.listCollections({ name: col }).toArray();
      if (existing.length === 0) {
        console.log(`  — ${col}: tidak ada di sumber, dilewati`);
        continue;
      }

      const docs = await oldDb.collection(col).find({}).toArray();
      if (docs.length === 0) {
        console.log(`  — ${col}: kosong, dilewati`);
        continue;
      }

      // Drop target collection and re-insert
      await newDb.collection(col).drop().catch(() => {});
      await newDb.collection(col).insertMany(docs, { ordered: false });

      console.log(`  ✓ ${col}: ${docs.length} dokumen dimigrasi`);
      totalMigrated += docs.length;
    } catch (err) {
      console.error(`  ✗ ${col}: ERROR — ${err.message}`);
    }
  }

  console.log(`\n${totalMigrated} total dokumen dimigrasi.\n`);

  // Create indexes on new DB
  console.log('Membuat indexes di database baru...\n');
  await createIndexes(newDb);

  await oldConn.close();
  await newConn.close();

  console.log('\n=== Migrasi Selesai ===\n');
  process.exit(0);
}

async function createIndexes(db) {
  const specs = [
    {
      col: 'users',
      indexes: [
        { key: { email: 1 }, options: { unique: true, name: 'email_unique' } }
      ]
    },
    {
      col: 'emails',
      indexes: [
        { key: { 'to.userId': 1, status: 1, createdAt: -1 }, options: { name: 'inbox_query' } },
        { key: { 'from.userId': 1, status: 1, createdAt: -1 }, options: { name: 'sent_query' } }
      ]
    },
    {
      col: 'activitylogs',
      indexes: [
        { key: { userId: 1, createdAt: -1 }, options: { name: 'user_logs' } },
        { key: { action: 1, createdAt: -1 }, options: { name: 'action_logs' } },
        { key: { category: 1, createdAt: -1 }, options: { name: 'category_logs' } },
        { key: { createdAt: -1 }, options: { name: 'recent_logs' } }
      ]
    },
    {
      col: 'shorturls',
      indexes: [
        { key: { shortCode: 1 }, options: { unique: true, name: 'shortcode_unique' } },
        { key: { userId: 1, createdAt: -1 }, options: { name: 'user_urls' } }
      ]
    },
    {
      col: 'tasks',
      indexes: [
        { key: { 'createdBy.userId': 1, createdAt: -1 }, options: { name: 'created_tasks' } },
        { key: { 'assignedTo.userId': 1, createdAt: -1 }, options: { name: 'assigned_tasks' } },
        { key: { status: 1 }, options: { name: 'task_status' } }
      ]
    },
    {
      col: 'signatures',
      indexes: [
        { key: { userId: 1 }, options: { unique: true, name: 'user_signature' } }
      ]
    },
    {
      col: 'agreements',
      indexes: [
        { key: { nomor: 1 }, options: { unique: true, name: 'nomor_unique' } },
        { key: { type: 1, tahun: 1 }, options: { name: 'type_year' } },
        { key: { status: 1 }, options: { name: 'agreement_status' } }
      ]
    },
    {
      col: 'doccounters',
      indexes: [
        { key: { key: 1 }, options: { unique: true, name: 'counter_key' } }
      ]
    }
  ];

  for (const spec of specs) {
    for (const idx of spec.indexes) {
      try {
        await db.collection(spec.col).createIndex(idx.key, idx.options);
        console.log(`  ✓ Index [${spec.col}] ${idx.options.name}`);
      } catch (e) {
        // Index already exists or collection empty — skip
        if (!e.message.includes('already exists')) {
          console.log(`  — Index [${spec.col}] ${idx.options.name}: ${e.message}`);
        }
      }
    }
  }
}

migrate().catch(err => {
  console.error('\nMigrasi gagal:', err.message);
  process.exit(1);
});
