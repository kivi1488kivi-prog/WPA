// Writes tenants/_schema/business.schema.json (editor autocompletion/validation).
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BusinessSchema } from './schema.ts';
import { TENANTS_DIR } from './lib.ts';

const schema = z.toJSONSchema(BusinessSchema, { io: 'input', unrepresentable: 'any' });
await writeFile(path.join(TENANTS_DIR, '_schema/business.schema.json'), JSON.stringify(schema, null, 2) + '\n');
console.log('✓ tenants/_schema/business.schema.json');
