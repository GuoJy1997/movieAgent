import type { PreparedGeneration } from '../../contracts/src/generation.ts';
import { isProviderVerification, providerVerificationCapabilities, type ProviderVerification } from '../../contracts/src/models.ts';
import type { LibraryHandle } from '../../storage/src/database.ts';
export type ProbeResult = ProviderVerification;
/** Single SQLite writer. No probe performs paid generation or invents a free authentication endpoint. */
export class ProviderEvidence {
 private readonly library:LibraryHandle;
 constructor(library:LibraryHandle){this.library=library;}
 read(input:PreparedGeneration):ProbeResult{
  const c=input.config.connection,m=input.config.model.modelId;
  const row=this.library.db.prepare('SELECT state_json FROM provider_verification WHERE library_id=? AND connection_id=? AND connection_revision=? AND model_id=?').get(c.libraryId,c.id,c.revision,m);
  if(row){const state:unknown=JSON.parse(row.state_json as string);if(!isProviderVerification(state))throw Error('INVALID_PROVIDER_VERIFICATION');return state;}
  const capabilities=providerVerificationCapabilities(c.adapterType);if(!capabilities)throw Error('INVALID_PROVIDER_VERIFICATION');
  return {connectionRef:{libraryId:c.libraryId,id:c.id,revision:c.revision},modelId:m,adapterId:c.adapterType,configuration:'valid',authentication:'unknown',generation:'unverified',fixtureGeneration:false,capabilities,checkedAt:new Date().toISOString()};
 }
 record(input:PreparedGeneration,change:Partial<Pick<ProbeResult,'configuration'|'authentication'|'generation'|'fixtureGeneration'>>):ProbeResult{
  const own=this.library.checkOwnership();if(!own.ok)throw Error('LIBRARY_OWNERSHIP');
  const state={...this.read(input),...change,checkedAt:new Date().toISOString()},c=state.connectionRef;
  if(!isProviderVerification(state))throw Error('INVALID_PROVIDER_VERIFICATION');
  this.library.db.prepare('INSERT INTO provider_verification VALUES(?,?,?,?,?) ON CONFLICT(library_id,connection_id,connection_revision,model_id) DO UPDATE SET state_json=excluded.state_json').run(c.libraryId,c.id,c.revision,state.modelId,JSON.stringify(state));
  return state;
 }
}
