const Discord = require('discord.js')

const token = process.env.DISCORD_TOKEN
const commGuildId = process.env.COMM_GUILD_ID
const adminRoleId = process.env.ADMIN_ROLE_ID

const ownerTag = '@Gjum#1398'
const ownerId = '730426592332873858'

const categoryNameForId = (gameId) => 'Test' //`Diplomacy Gaming ${gameId}`
const spectatorRoleNameForGame = (gameId) => `Spectator ${gameId}`

const nationNames = 'Austria England France Germany Italy Russia Turkey'.split(' ')

/** @type {Discord.PermissionString[]} */
const useChannelPerms = ['READ_MESSAGE_HISTORY', 'SEND_MESSAGES', 'VIEW_CHANNEL']

const d = new Discord.Client()
d.on('error', (e) => console.error(e))
d.on('warn', (e) => console.warn(e))

/** @type {Discord.Guild} */
let guild

/** @type {Game} */
let game

class Game {
	initialized = false

	/** @type {{[nationName:string]: Discord.Role}} */
	nationRoles = {}

	/** @type {{[nationName:string]: Discord.GuildMember}} */
	nationUsers = {}

	constructor(id) {
		this.id = id
		this.initialize()
	}

	async initialize() {
		for (const nationName of nationNames) {
			const roleName = `${nationName} ${this.id}`.toLowerCase()
			const role = await guild.roles.cache.find((r) => r.name.toLowerCase() === roleName)
			if (!role) throw new Error(`Could not find role ${roleName}`)
			this.nationRoles[nationName] = role
			this.nationUsers[nationName] = role.members.first()
		}

		this.initialized = true
	}
}

/** @param {Discord.GuildMember} member */
async function findNationForMember(member) {
	const [name] =
		Object.entries(game.nationUsers).find(([n, u]) => u.id === member.id) || []
	if (!name) return null
	const role = game.nationRoles[name]
	if (!role) return null

	// verify the nation role hasn't been reassigned since initializing the game
	const memberHasNationRole = member.roles.cache.has(role.id)
	if (!memberHasNationRole) return null

	return { name, role }
}

/** @param {Discord.Message} message */
async function helpCommand(message) {
	const canReloadBot = await reloadCommandPermitted(message)

	let response =
		'`group <nation1> <nation2>` - Create a group chat with these nations' +
		'\n`help` - Show available commands'
	if (canReloadBot)
		response += '\n`reload` - Reload the bot to internally update roles and players'

	message.channel.send(response)
}

async function reloadCommandPermitted(message) {
	const member = guild.member(message.author)
	const hasAdminRole = member.roles.cache.get(adminRoleId)
	const isBotOwner = member.id === ownerId
	return hasAdminRole || isBotOwner
}

/** @param {Discord.Message} message */
async function reloadCommand(message) {
	const canReloadBot = await reloadCommandPermitted(message)
	if (!canReloadBot) return message.channel.send(`Ask an admin to reload the bot.`)

	game = new Game(1)
}

const createGroupChatRegex = /^!? *(create *)?group (?<nations>([A-Za-z]+( +|$)){2,})/i
/** @param {Discord.Message} message */
async function createGroupChatCommand(message) {
	const member = guild.member(message.author)

	/** @type {{[nationNAme:string]: Discord.Role}} */
	const nationsChan = {}
	/** @type {Discord.OverwriteResolvable[]} */
	const permissionOverwrites = []

	const { name: nationNameUser, role: nationRoleUser } =
		(await findNationForMember(member)) || {}
	if (!nationNameUser && member.id !== ownerId) {
		return message.channel.send(
			`You don't have the right nation role. Contact an admin or ${ownerTag} to !reload the bot.`
		)
	}
	if (nationNameUser) nationsChan[nationNameUser] = nationRoleUser

	const match = createGroupChatRegex.exec(message.content)
	for (const nationNameRaw of match.groups.nations.split(/ +/g)) {
		if (!nationNameRaw.trim()) continue // consecutive spaces, ignore
		let nationName = nationNameRaw
		nationName = nationName.toLowerCase()
		nationName = nationNames.find((n) => n.toLowerCase() === nationName)
		const nationRole = game.nationRoles[nationName]
		if (!nationRole) return message.channel.send(`Unknown nation name: ${nationNameRaw}`)
		nationsChan[nationName] = nationRole
	}

	if (Object.keys(nationsChan).length < 3)
		return message.channel.send(`The group channel needs 3 or more nations.`)

	function pushPerms(roleId, allow = false) {
		permissionOverwrites.push({
			id: roleId,
			allow: allow ? useChannelPerms : undefined,
			deny: !allow ? undefined : useChannelPerms,
		})
	}

	for (const [nationName, nationRole] of Object.entries(game.nationRoles)) {
		const roleCanSeeChannel = !!nationsChan[nationName]
		pushPerms(nationRole.id, roleCanSeeChannel)
	}
	// deny @ everyone
	pushPerms(guild.id, false)
	// allow spectators
	const spectatorRole = guild.roles.cache.find(
		(r) => r.name === spectatorRoleNameForGame(game.id)
	)
	if (spectatorRole) pushPerms(spectatorRole?.id, true)

	// TODO check the group chat doesn't exist already

	// actually create the channel
	const parentCategoryName = categoryNameForId(game.id).toLowerCase()
	const parent = guild.channels.cache.find(
		(ch) => ch.type === 'category' && ch.name.toLowerCase() === parentCategoryName
	)
	const channelName = Object.keys(nationsChan).sort().join('-')

	const channel = await guild.channels.create(channelName, {
		parent: parent?.id || undefined,
		permissionOverwrites,
	})

	// ping Current Player role
	const currentPlayerRole = guild.roles.cache.find((r) => r.name === 'Current Player')
	if (currentPlayerRole) {
		channel.send(`<@&${currentPlayerRole.id}>`)
	}
}

d.on('ready', async () => {
	console.log(
		`Discord connected. @${d.user.username}#${d.user.discriminator} <@${d.user.id}>`
	)
	d.user.setActivity({ name: 'Backstabbr', emoji: ':dagger:' })
	guild = await d.guilds.fetch(commGuildId)
	game = new Game(1)
})

d.on('message', async (message) => {
	try {
		if (!message.author || message.author.bot) return // ignore bots
		if (message.channel.type !== 'dm') return // only allow running commands from DMs

		if (!game || !game.initialized)
			return message.channel.send(
				`Please wait a moment for the bot to finish launching, then try again.`
			)

		await guild.members.fetch(message.author)

		const member = guild.member(message.author)
		if (!member)
			return message.channel.send(`Join the server first: https://discord.gg/zXCJHTb`)

		if (createGroupChatRegex.test(message.content)) return createGroupChatCommand(message)
		if (/^!? *(restart|reload)/i.test(message.content)) return reloadCommand(message)
		return helpCommand(message)
	} catch (err) {
		message.channel.send(`There was an error while running your command :(`)
		throw err
	}
})

d.login(token)
