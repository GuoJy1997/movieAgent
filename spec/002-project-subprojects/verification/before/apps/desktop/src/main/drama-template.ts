/** Bundled with main; never reads templates from cwd. See templates/drama-project/README.md. */
export const dramaTemplate = {
  directories: [
    'scripts', 'scripts/episodes', 'storyboards', 'assets', 'assets/characters', 'assets/scenes', 'assets/props', 'assets/imports',
    'shots', 'shots/episode-001', 'audio', 'audio/voice', 'audio/music', 'audio/sfx', 'exports', '.movieagent', '.movieagent/library',
  ],
  files: {
    'scripts/outline.md': '# 故事大纲\n',
    'scripts/episodes/episode-001.md': '# 第 001 集\n',
    'storyboards/episode-001.json': '{\n  "schemaVersion": 1,\n  "shots": []\n}\n',
  },
} as const;
