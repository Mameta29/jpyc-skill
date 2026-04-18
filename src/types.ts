import type { CommandModule } from 'yargs';

/** acli が提供する共有機能（acli の PluginContext と同じインターフェース） */
export interface PluginContext {
  readonly wallet: {
    getWalletId(name: string): string | undefined;
    getEvmAddress(name: string): string | undefined;
    signMessage(
      walletId: string,
      chainId: string,
      message: string,
      passphrase?: string,
    ): { signature: string; recoveryId?: number };
    signTypedData(
      walletId: string,
      chainId: string,
      typedDataJson: string,
      passphrase?: string,
    ): { signature: string; recoveryId?: number };
  };
  readonly credential: {
    resolve(apiKey?: string): string | undefined;
  };
  readonly crypto: {
    send(params: {
      name: string;
      to: string;
      amount: string;
      token?: string;
      chain?: string;
      broadcast?: boolean;
      credential?: string;
    }): Promise<unknown>;
  };
  readonly config: {
    get(key: string): string | undefined;
  };
  readonly output: {
    success<T>(data: T): { ok: true; data: T };
    error(code: string, message: string): { ok: false; error: { code: string; message: string } };
    print(envelope: unknown): void;
    handleError(err: unknown): never;
  };
}

export interface PluginSkill {
  readonly name: string;
  readonly skillDir: string;
}

export interface AcliPlugin {
  readonly name: string;
  readonly commands?: CommandModule | CommandModule[];
  readonly skills?: readonly PluginSkill[];
  readonly dependencies?: readonly string[];
}

export type PluginFactory = (ctx: PluginContext) => AcliPlugin;
