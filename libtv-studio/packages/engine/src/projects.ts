import { randomUUID } from 'node:crypto';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { parseCreateProject, type ProjectRef } from '../../contracts/src/projects.ts';
import type { LibraryHandle } from '../../storage/src/database.ts';

export function projectsFor(library: LibraryHandle) {
  return {
    create(input: unknown): Result<ProjectRef> {
      const ownership = library.checkOwnership();
      if (!ownership.ok) return ownership;
      const parsed = parseCreateProject(input);
      if (!parsed.ok) return parsed;
      const project: ProjectRef = { id: randomUUID(), libraryId: library.libraryId, name: parsed.value.name, createdAt: new Date().toISOString() };
      try {
        library.db.prepare('INSERT INTO project(id, library_id, name, created_at) VALUES (?, ?, ?, ?)').run(project.id, project.libraryId, project.name, project.createdAt);
        library.db.prepare('INSERT INTO canvas(id,project_id,library_id) VALUES(?,?,?)').run(project.id, project.id, project.libraryId);
        return ok(project);
      } catch { return fail('PROJECT_WRITE_FAILED', '无法保存项目，请检查资料库与磁盘空间。'); }
    },
    list(): Result<ProjectRef[]> {
      const ownership = library.checkOwnership();
      if (!ownership.ok) return ownership;
      try {
        return ok(library.db.prepare('SELECT id, library_id AS libraryId, name, created_at AS createdAt FROM project ORDER BY rowid').all() as unknown as ProjectRef[]);
      } catch { return fail('PROJECT_READ_FAILED', '无法读取项目，请重新打开资料库。'); }
    },
  };
}
