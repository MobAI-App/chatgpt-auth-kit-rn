import * as Keychain from 'react-native-keychain';

import { Credentials, CredentialsJSON } from './credentials';

const SERVICE = 'chatgpt-auth-kit';

export const CredentialsStore = {
  async save(creds: Credentials): Promise<void> {
    const data = JSON.stringify(creds.toJSON());
    await Keychain.setGenericPassword('chatgpt-oauth', data, {
      service: SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },

  async load(): Promise<Credentials | null> {
    const result = await Keychain.getGenericPassword({ service: SERVICE });
    if (!result) return null;
    try {
      const json = JSON.parse(result.password) as CredentialsJSON;
      return Credentials.fromJSON(json);
    } catch {
      return null;
    }
  },

  async clear(): Promise<void> {
    await Keychain.resetGenericPassword({ service: SERVICE });
  },
};
