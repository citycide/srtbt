import { _, it } from 'param.macro'

import { join, isAbsolute, sep, relative } from 'path'

import FP from 'functional-promises'
import throttle from 'p-throttle'
import callsites from 'callsites'
import {
  get,
  has,
  map,
  once,
  reduce,
  set
} from 'stunsail'

import log from '../logger'
import isSubdirectory from './util/is-subdirectory'

import {
  internalPluginDirectory,
  externalPluginDirectory
} from './plugins'

export const registry = {}

const commandProperties = new Set([
  'cooldown',
  'permission',
  'status',
  'price'
])

const getCommandProperty = (command, property) => {
  if (!commandExists(command)) return

  if (commandProperties.has(property)) {
    return get(registry, [command, property])
  }
}

const getSubcommandProperty = (command, sub, property) => {
  if (!commandExists(command)) return

  if (commandProperties.has(property)) {
    return get(registry, [command, 'subcommands', sub, property])
  }
}

const setCommandProperty = (command, property, value) => {
  if (!commandExists(command)) return

  if (commandProperties.has(property)) {
    set(registry, [command, property], value)
  }
}

const setSubcommandProperty = (command, sub, property, value) => {
  if (!commandExists(command)) return

  if (commandProperties.has(property)) {
    set(registry, [command, 'subcommands', sub, property], value)
  }
}

const commandExists = (name, sub) =>
  has(registry, [name, ...(sub ? ['subcommands', sub] : [])])

const registerCommand = (context, command) => {
  const { name, caller } = command

  if (registry[name]) {
    if (registry[name].caller === caller) return

    log.debug(`Duplicate command registration attempted by '${caller}'`)
    log.debug(`!${name} already registered to '${registry[name].caller}'`)

    return
  }

  registry[name] = Object.assign({}, command, { subcommands: {} })

  log.absurd(`command loaded: '!${name}' (${caller})`)
  return context
}

const registerSubcommand = (context, subcommand) => {
  const { name, parent } = subcommand

  const container = registry[parent]

  if (!container) {
    log.error(`Parent command '${parent}' does not exist. (${name})`)
    return context
  }

  const pair = `${parent} ${name}`
  const reference = container.subcommands[name]

  if (reference) {
    if (reference.parent === parent) return context

    log.debug(`Duplicate subcommand registration attempted`)
    log.debug(`!${pair} is already registered`)

    return context
  }

  registry[parent].subcommands[name] = Object.assign({}, subcommand)

  log.absurd(`subcommand loaded: '!${pair}' (${container.caller})`)
  return context
}

const registerCustomCommand = (context, command) => {
  const { name } = command

  if (registry[name]) {
    log.debug(`'${name}' already in use. Custom command not added.`)
    return context
  }

  const flags = {
    caller: 'custom',
    subcommands: {}
  }

  registry[name] = Object.assign({}, command, flags)
  log.absurd(`command loaded: '!${name}' (custom)`)
  return context
}

const save = throttle(async context => {
  log.trace('saving commands')

  await registry |> map(_, command => {
    return FP.all([
      context.db.updateOrCreate('commands', {
        name: command.name
      }, {
        handler: command.handler,
        caller: command.caller,
        status: command.status,
        cooldown: command.cooldown,
        permission: command.permission,
        price: command.price
      }),

      ...reduce(command.subcommands, (promises, sub) => {
        return [context.db.updateOrCreate('subcommands', {
          name: sub.name,
          parent: command.name
        }, {
          status: sub.status,
          cooldown: sub.cooldown,
          permission: sub.permission,
          price: sub.price
        }), ...promises]
      }, [])
    ])
  }) |> FP.all

  log.trace('saved commands')
}, 1, 10_000)

const loadTables = context =>
  FP.all([
    context.db.model('commands', {
      name: { type: String, primary: true },
      caller: { type: String, notNullable: true },
      handler: { type: String, notNullable: true },
      status: { type: Number, defaultTo: 0 },
      cooldown: { type: Number, defaultTo: 30 },
      permission: { type: Number, defaultTo: 5 },
      price: { type: Number, defaultTo: 0 }
    }),

    context.db.model('subcommands', {
      name: String,
      parent: String,
      status: { type: Number, defaultTo: -1 },
      cooldown: { type: Number, defaultTo: -1 },
      permission: { type: Number, defaultTo: -1 },
      price: { type: Number, defaultTo: -1 }
    }, {
      primary: ['name', 'parent']
    })
  ])

const loadCommands = context => {
  log.trace('loading commands')

  return FP.all([
    context.db.find('commands').then(commands => {
      commands.forEach(command => {
        if (command.caller === 'custom') {
          registerCustomCommand(context, command)
          return
        }

        registerCommand(context, command)
      })
    }),

    context.db.find('subcommands')
      .then(it.forEach(registerSubcommand(context, _)))
  ])
}

const isCommandType = (caller, kind) =>
  caller.split(sep)[0] === kind

const isInternalCommand = caller =>
  !isAbsolute(caller) && isCommandType(caller, 'internal')

const isExternalCommand = caller =>
  !isAbsolute(caller) && isCommandType(caller, 'plugins')

const deserializePath = caller => {
  if (isInternalCommand(caller)) {
    return join(internalPluginDirectory, '..', caller)
  }

  if (isExternalCommand(caller)) {
    return join(externalPluginDirectory, '..', caller)
  }
}

export const stageCommand = name => {
  const { caller, handler } = registry[name]

  if (caller === 'custom') {
    return (context, event) => {
      return context.params(event, handler)
        // TODO: this should whisper if necessary ie. `event.respond`,
        // but manually built events don't have that method
        .then(context.say)
    }
  }

  const callerPath = deserializePath(caller)

  if (!callerPath) return

  delete require.cache[callerPath]
  return require(callerPath)[handler]
}

const serializePath = caller => {
  if (isSubdirectory(caller, internalPluginDirectory)) {
    return relative(internalPluginDirectory, caller) |>
      join('internal', _)
  }

  if (isSubdirectory(caller, externalPluginDirectory)) {
    return relative(externalPluginDirectory, caller) |>
      join('plugins', _)
  }

  return caller
}

export const addCommand = (context, name, options) => {
  if (!name) return

  const caller = serializePath(callsites()[2].getFileName())

  const object = Object.assign({
    handler: name,
    cooldown: 30,
    permission: 5,
    status: 1,
    price: 0
  }, options, {
    name: name.toLowerCase(),
    caller
  })

  return registerCommand(context, object)
}

export const addSubcommand = (context, name, parent, options) => {
  if (!name || !parent || !registry[parent]) return

  const caller = callsites()[2].getFileName()
  const object = Object.assign({
    cooldown: -1,
    permission: -1,
    status: -1,
    price: -1
  }, options, {
    name: name.toLowerCase(),
    caller,
    parent
  })

  return registerSubcommand(context, object)
}

export const addCustomCommand = (context, name, options) => {
  if (!name) return

  options = Object.assign({}, options)

  const object = Object.assign({
    cooldown: 30,
    permission: 5,
    status: 1,
    price: 0
  }, options, {
    name: name.toLowerCase(),
    caller: 'custom',
    handler: options.response || options.handler
  })

  return registerCustomCommand(context, object)
}

export const getCommand = registry[_]
export const getSubcommand = registry[_].subcommands[_]

const getProperty = (command, ...args) => {
  let sub
  let property = args[0]
  if (args.length === 2) {
    ;[sub, property] = args
  }

  return sub
    ? getSubcommandProperty(command, sub, property)
    : getCommandProperty(command, property)
}

const setProperty = context => (command, ...args) => {
  let sub
  let property = args[0]
  if (args.length === 2) {
    ;[sub, property] = args
  }

  const result = sub
    ? setSubcommandProperty(command, sub, property)
    : setCommandProperty(command, property)

  save(context)

  return result
}

export const loadRegistry = once(async context => {
  log.trace('creating registry')

  const _addCommand = addCommand(context, _, _)
  const _addSubcommand = addSubcommand(context, _, _, _)
  const _addCustomCommand = addCustomCommand(context, _, _)

  context.extend({
    addCommand: _addCommand,
    addSubcommand: _addSubcommand,
    addCustomCommand: _addCustomCommand,

    command: {
      exists: commandExists,
      getProperty: getProperty,
      setProperty: setProperty,
      isEnabled: (name, sub) =>
        getProperty(name, sub, 'status') > 0,
      getPermLevel: (name, sub) =>
        getProperty(name, sub, 'permission')
    }
  })

  context.on('beforeShutdown', save)

  await loadTables(context)
  await loadCommands(context)
  return registry
})
