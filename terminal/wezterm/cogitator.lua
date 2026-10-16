-- Cogitator for WezTerm: the amber data-slate of the mission-control `warhammer` theme, the
-- twin of terminal/ghostty/cogitator.conf + cogitator.glsl.
--
-- WezTerm runs no custom shader, so the brass housing the Ghostty shader draws in the
-- window's padding is a picture here: tools/make-housing.py draws it with the shader's own
-- maths for one window size (rivets, corner medallions and the hazard band placed by the
-- window's pixels, never stretched), and this module lays it under the text as the window's
-- background. A size met for the first time is drawn in the background (about a second; the
-- last housing stands stretched meanwhile) and kept in a cache folder.
--
-- Installed by `node tools/install.mjs`: a marked block in ~/.wezterm.lua calls
--   dofile('<repo>/terminal/wezterm/cogitator.lua').apply(config, { root = '<repo>', python = '<python>' })
-- `node tools/install.mjs --uninstall` removes the block.

local wezterm = require 'wezterm'

local M = {}

-- The glass and its sixteen inks: cogitator.conf's palette.
local GLASS = '#0E0A05'
local SCHEME = {
  background = GLASS,
  foreground = '#F2B04A',
  cursor_bg = '#FFD27A',
  cursor_fg = GLASS,
  cursor_border = '#FFD27A',
  selection_bg = '#5A3F12',
  selection_fg = '#FFE0A0',
  ansi = { '#0E0A05', '#E8452F', '#A5B84E', '#FFBF4D', '#6B93C9', '#AB84C4', '#8FB8A0', '#E09A2E' },
  brights = { '#5A4220', '#FF6A4D', '#C4D65A', '#FFD27A', '#8FB0E0', '#C8A0E0', '#B0D8C0', '#FFF0C8' },
}

-- The shader's housing width (cogitator.glsl BEZEL, a Retina screen's pixels) and the glass
-- left between it and the text.
local BEZEL = 44
local GAP = 16

local function exists(file)
  local f = io.open(file, 'rb')
  if f == nil then return false end
  f:close()
  return true
end

local function slash(p)
  return (p:gsub('\\', '/'))
end

-- A housing scale for a screen: the shader's pixels are a Retina screen's, 0.8 of them suits 1x.
local function scale_for(dpi)
  local s = 0.8 * (dpi or 96) / 96
  return math.floor(s * 100 + 0.5) / 100
end

local function padding_for(scale)
  local p = math.ceil((BEZEL + GAP) * scale)
  return { left = p, right = p, top = p, bottom = p }
end

local function layers(file)
  local list = { { source = { Color = GLASS }, width = '100%', height = '100%' } }
  if file ~= nil then
    table.insert(list, {
      source = { File = file },
      width = '100%',
      height = '100%',
      repeat_x = 'NoRepeat',
      repeat_y = 'NoRepeat',
    })
  end
  return list
end

--- Puts the slate on `config`. `opts.root` is this repository; `opts.python` the Python 3
--- with numpy and Pillow that draws the housing (`python` by default); `opts.cache` the folder
--- the housings are kept in.
function M.apply(config, opts)
  opts = opts or {}
  local root = slash(opts.root or '.')
  local python = opts.python or 'python'
  local cache = slash(opts.cache
    or ((os.getenv('LOCALAPPDATA') or (wezterm.home_dir .. '/.cache')) .. '/singularity-mods/housing'))
  local script = root .. '/tools/make-housing.py'
  local aquila = root .. '/terminal/ghostty/aquila.png'
  local last_file = cache .. '/last.txt'

  config.color_schemes = config.color_schemes or {}
  config.color_schemes.Cogitator = SCHEME
  config.color_scheme = 'Cogitator'
  config.bold_brightens_ansi_colors = false
  config.default_cursor_style = 'SteadyBlock'
  config.font = wezterm.font_with_fallback({ 'MesloLGS Nerd Font Mono', 'MesloLGS NF', 'JetBrains Mono' })
  -- One window, one slate: no tab bar until a second tab is opened, no scroll bar over the bezel.
  config.hide_tab_bar_if_only_one_tab = true
  config.enable_scroll_bar = false
  config.window_frame = { active_titlebar_bg = '#1A1208', inactive_titlebar_bg = GLASS }
  config.colors = config.colors or {}
  config.colors.tab_bar = {
    background = GLASS,
    active_tab = { bg_color = '#8A6A32', fg_color = GLASS },
    inactive_tab = { bg_color = '#1A1208', fg_color = '#E09A2E' },
    new_tab = { bg_color = GLASS, fg_color = '#E09A2E' },
  }

  -- The padding the housing stands in, for a screen at 1x until a window says its DPI.
  local base_scale = scale_for(96)
  config.window_padding = padding_for(base_scale)

  -- Until a window has its own, the last housing drawn (stretched for a moment).
  local last = nil
  local f = io.open(last_file, 'r')
  if f ~= nil then
    last = f:read('*l')
    f:close()
    if last ~= nil and not exists(last) then last = nil end
  end
  config.background = layers(last)

  local seen = {}    -- window id -> the size key met at the last look
  local shown = {}   -- window id -> the size key whose housing it shows
  local asked = {}   -- housing file -> true once its drawing was started

  local function look(window)
    local d = window:get_dimensions()
    local scale = scale_for(d.dpi)
    local key = string.format('%dx%d@%s', d.pixel_width, d.pixel_height, tostring(scale))
    local id = window:window_id()
    if shown[id] == key then return end
    local file = string.format('%s/housing-%dx%d-%d.png', cache, d.pixel_width, d.pixel_height, math.floor(scale * 100 + 0.5))
    if exists(file) then
      local o = window:get_config_overrides() or {}
      o.background = layers(file)
      o.window_padding = padding_for(scale)
      window:set_config_overrides(o)
      shown[id] = key
      local w = io.open(last_file, 'w')
      if w ~= nil then
        w:write(file)
        w:close()
      end
      return
    end
    -- A size held still for one look is drawn; one passing by in a drag is not.
    if seen[id] ~= key then
      seen[id] = key
      return
    end
    if not asked[file] then
      asked[file] = true
      wezterm.background_child_process({
        python, script,
        '--size', string.format('%dx%d', d.pixel_width, d.pixel_height),
        '--scale', tostring(scale),
        '--aquila', aquila,
        '--out', file,
      })
    end
  end

  -- Twice a second: a new size is seen at once and drawn after it held still for a look.
  config.status_update_interval = math.min(config.status_update_interval or 1000, 500)
  wezterm.on('update-status', function(window, _pane)
    local ok, err = pcall(look, window)
    if not ok then wezterm.log_error('cogitator housing: ' .. tostring(err)) end
  end)

  return config
end

return M
