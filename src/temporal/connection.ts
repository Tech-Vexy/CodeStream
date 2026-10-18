import { Client, Connection } from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';

/**
 * Connection settings from TEMPORAL_ADDRESS / TEMPORAL_NAMESPACE / TEMPORAL_API_KEY (or a Temporal
 * config file). Blank variables are ignored: an empty TEMPORAL_API_KEY would otherwise switch on TLS.
 */
export function temporalConnectConfig() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''),
  );
  const { connectionOptions, namespace } = loadClientConnectConfig({ overrideEnvVars: env });
  return { connectionOptions, namespace: namespace ?? 'default' };
}

export async function connectTemporalClient(): Promise<{ client: Client; connection: Connection }> {
  const { connectionOptions, namespace } = temporalConnectConfig();
  const connection = await Connection.connect(connectionOptions);
  return { client: new Client({ connection, namespace }), connection };
}
