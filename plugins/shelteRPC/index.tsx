import RegisteredGames from './components/RegisteredGames'

interface AssetCache {
  [key: string]: {
    id: string
    name: string
    type: number
  }[]
}

const {
  flux: {
    dispatcher: FluxDispatcher,
    stores: {
      GameStore
    }
  },
  settings: {
    registerSection
  },
  ui: {
    showToast
  },
  plugin: {
    store
  },
  http
} = shelter

let maybeUnregisterGameSetting = () => {}

const cachedAssets: AssetCache = {}

let ws: WebSocket
const apps: Record<string, { name: string } | string> = {}

// when we load, set current game as nothing
store.currentlyPlaying = ''

async function lookupApp(name: string): Promise<string> {
  return GameStore.getGameByName(name)?.name || 'Unknown'
}

export const generateAssetId = async (appId: string, asset: string) => {
  // get cached assets for the appid if we dont have them already
  if (!cachedAssets[appId]) {
    const resp = await http.get(`/oauth2/applications/${appId}/assets`)

    if (resp.status !== 200) {
      console.log('Failed to fetch assets')
    }

    cachedAssets[appId] = resp.body as AssetCache[typeof appId]
  }

  const assetId = cachedAssets[appId].find(a => a.name === asset)?.id

  return assetId
}

async function handleMessage(e: MessageEvent<string>) {
  const data = JSON.parse(e.data)
  const assets = data.activity?.assets

  if (assets?.large_image) assets.large_image = await generateAssetId(data.activity.application_id, assets.large_image)
  if (assets?.small_image) assets.small_image = await generateAssetId(data.activity.application_id, assets.small_image)

  if (data.activity) {
    const appId = data.activity.application_id
    apps[appId] ||= await lookupApp(data.activity.name)
    
    const app = apps[appId]
    if (typeof app !== 'string') {
      data.activity.name ||= app.name
    }

    store.currentlyPlaying = data.activity.name

    if (!store.previouslyPlayed) store.previouslyPlayed = {}

    if (!data.activity?.name) return

    // If this isn't already in the list, add it
    if (!(data.activity.name in store.previouslyPlayed)) {
      store.previouslyPlayed[data.activity.name] = {}
    }

    store.previouslyPlayed[data.activity.name].name = data.activity.name
    store.previouslyPlayed[data.activity.name].appid = data.activity.application_id
    store.previouslyPlayed[data.activity.name].lastPlayed = Date.now()
    store.previouslyPlayed[data.activity.name].local = data.activity.application_id === '1337'
  } else {
    // Clear out "currentlyPlaying"
    store.currentlyPlaying = ''
  }

  // If this activity should be hidden, don't update activity
  if (store.previouslyPlayed[data.activity?.name]?.hide) return
  
  FluxDispatcher.dispatch({
    type: 'LOCAL_ACTIVITY_UPDATE',
    ...data
  })
}

export const onLoad = async () => {
  if (ws && ws?.close) ws.close()

  ws = new WebSocket('ws://127.0.0.1:1337')
  ws.onmessage = handleMessage
  ws.onerror = (e) => console.error(e)

  // See if we were able to connect after a second
  const connected = await new Promise(r => setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      console.log(ws)
      ws?.close()
      ws = null

      showToast({
        title: 'ShelteRPC',
        content: 'Unable to connect to ShelteRPC server',
        duration: 3000
      })

      r(false)
    }

    r(true)
  }, 1000))

  maybeUnregisterGameSetting = registerSection('section', 'shelterpc', 'Registered Games', RegisteredGames)

  if (!connected) return

  ws.onclose = () => {
    showToast({
      title: 'ShelteRPC',
      content: 'ShelteRPC server disconnected',
      duration: 3000
    })
  }

  showToast({
    title: 'ShelteRPC',
    content: 'Connected to ShelteRPC server',
    duration: 3000
  })
}

export const onUnload = async () => {
  if (ws?.close) ws.close?.()
  
  if (maybeUnregisterGameSetting) maybeUnregisterGameSetting()
}