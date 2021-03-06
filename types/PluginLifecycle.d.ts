import { Core, ChatEvent } from "./index"
import { Store } from "@converge/state"

export type HookListener =
  (core: Core, event: ChatEvent) => unknown

export type HookListenerWithStore <
  T = Record<string, unknown>,
  A extends Actions<T> = Actions<T>
> =
  (core: Core, event: ChatEvent, store: Store<T, A>) => unknown

export interface PluginLifecycle <
  T = Record<string, unknown>,
  A extends Actions<T> = Actions<T>
> {
  /**
   * Called on plugin load.
   */
  setup?: (core: Core) => void | undefined | Store<T, A> | Promise<Store<T, A> | void | undefined>

  /**
   * Called whenever the bot receives a potential command,
   * but there are no guarantees that the command actually
   * exists or is enabled yet.
   */
  receivedCommand?: HookListenerWithStore<T, A>

  /**
   * Called when the bot is about to run a command.
   * Allows for an opportunity to stop the command from
   * running entirely by calling the `prevent` method on
   * the chat event.
   */
  beforeCommand?: HookListenerWithStore<T, A>

  /**
   * Called whenever chat receives a new message.
   */
  beforeMessage?: HookListenerWithStore<T, A>

  /**
   * Called whenever a command has been prevented.
   */
  preventedCommand?: HookListenerWithStore<T, A>

  /**
   * Called after any command is finished executing.
   */
  afterCommand?: HookListenerWithStore<T, A>

  /**
   * Any hooks called from plugins are defined here,
   * scoped by plugin name.
   *
   * @example
   *
   * ```js
   * export default {
   *   points: {
   *     beforePayout ($, e) {
   *       // do something
   *     }
   *   }
   * }
   * ```
   */

  /*
   * TODO: this isn't strict enough since any other properties than
   *       the ones above on a plugin component should only be allowed
   *       as `Record<string, HookListener>`, ref:
   *       https://github.com/microsoft/TypeScript/issues/17867
   */

  [pluginName: string]:
    | ((core: Core) => void | undefined | Store<T, A> | Promise<Store<T, A> | void | undefined>)
    | HookListenerWithStore<T, A>
    | Record<string, HookListenerWithStore<T, A>>
}
