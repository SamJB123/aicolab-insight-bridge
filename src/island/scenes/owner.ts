// The REPORT as an owner (@aicolab/atlas scenes/owners.ts): a report
// island's declaration says the report draws its SKY TABLE — the
// square's heart, told its radius and the record's stars (../sky-table.ts
// skyTableDrawn) — and the report draws it here: a stone plinth, a
// timber top, the face painted as the sky's bed, a star per topic at its
// baked place on its thread of light, and the hologram's own cool glow.
// The one thing the report draws; every other thing on its island is the
// kit's.

import { nodeMaterial, shaded } from '@aicolab/atlas/chessboard/scenes/island-geometry.ts'
import type { IslandOwner, OwnedModel } from '@aicolab/atlas/chessboard/scenes/owners.ts'
import * as THREE from 'three/webgpu'
import { z } from 'zod'
import { REPORT_OWNER, SKY_TABLE_ID } from '../sky-table.ts'

const STAR_COLOURS = ['#ffe6b0', '#ffd27a', '#fff3d6', '#f7c56a'] as const
/** The table: the plinth's height, the top's thickness, the face's height. */
const TABLE_PLINTH_H = 0.55
const TABLE_TOP_T = 0.14
const TABLE_FACE_Y = 1.02

/** What the declaration tells the report of its table. */
const toldSchema = z.object({
	radius: z.number().positive(),
	stars: z.array(
		z.object({
			x: z.number(),
			y: z.number(),
			r: z.number(),
			accent: z.string(),
			label: z.string(),
		}),
	),
})

/** The face's paint: dark glass with a faint grid, the hologram's bed,
 *  painted on a canvas. */
function skyBed(): THREE.CanvasTexture {
	const size = 1024
	const canvas = document.createElement('canvas')
	canvas.width = size
	canvas.height = size
	const ctx = canvas.getContext('2d')
	if (!ctx) throw new Error('[report] 2D canvas unavailable for the sky table')
	const glass = ctx.createRadialGradient(
		size / 2,
		size / 2,
		size * 0.1,
		size / 2,
		size / 2,
		size / 2,
	)
	glass.addColorStop(0, '#16233a')
	glass.addColorStop(1, '#070b14')
	ctx.fillStyle = glass
	ctx.fillRect(0, 0, size, size)
	ctx.strokeStyle = 'rgba(120, 160, 220, 0.18)'
	ctx.lineWidth = 1.5
	for (let r = size * 0.12; r < size * 0.5; r += size * 0.12) {
		ctx.beginPath()
		ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2)
		ctx.stroke()
	}
	ctx.beginPath()
	ctx.moveTo(size / 2, 0)
	ctx.lineTo(size / 2, size)
	ctx.moveTo(0, size / 2)
	ctx.lineTo(size, size / 2)
	ctx.stroke()
	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	return texture
}

/** The table at the square's heart, at the origin: a stone plinth, a
 *  timber top, the face painted as the sky's bed; over it a star per topic
 *  at its baked place on its thread of light, and the hologram's own
 *  cool glow. Bare, the face is left unpainted: a build with no renderer
 *  has no canvas and no one to see it. */
function buildSkyTable(
	radius: number,
	stars: readonly { x: number; y: number; r: number }[],
	bare: boolean,
): OwnedModel {
	const group = new THREE.Group()
	group.name = SKY_TABLE_ID
	const stone = nodeMaterial('#cfc6b4', 0.9)
	const timber = nodeMaterial('#6b4a2b', 0.8)
	const brass = new THREE.MeshStandardNodeMaterial({
		color: '#c9a254',
		roughness: 0.35,
		metalness: 0.7,
	})
	// The plinth: two stone steps.
	group.add(
		shaded(new THREE.CylinderGeometry(radius * 1.25, radius * 1.35, 0.18, 40), stone, [0, 0.09, 0]),
	)
	group.add(
		shaded(new THREE.CylinderGeometry(radius * 0.72, radius * 0.8, TABLE_PLINTH_H, 32), stone, [
			0,
			0.18 + TABLE_PLINTH_H / 2,
			0,
		]),
	)
	// The drum up into the top; the top one plane in two materials.
	const drumTop = TABLE_FACE_Y - TABLE_TOP_T
	const drumBase = 0.18 + TABLE_PLINTH_H
	group.add(
		shaded(
			new THREE.CylinderGeometry(radius * 0.55, radius * 0.6, drumTop - drumBase, 32),
			timber,
			[0, (drumBase + drumTop) / 2, 0],
		),
	)
	group.add(
		shaded(new THREE.CylinderGeometry(radius, radius, TABLE_TOP_T, 48, 1, true), timber, [
			0,
			TABLE_FACE_Y - TABLE_TOP_T / 2,
			0,
		]),
	)
	const faceRadius = radius - 0.22
	const rim = new THREE.Mesh(new THREE.RingGeometry(faceRadius, radius, 64), timber)
	rim.rotation.x = -Math.PI / 2
	rim.position.y = TABLE_FACE_Y
	rim.receiveShadow = true
	rim.userData.collidable = false
	rim.userData.navmesh = false
	group.add(rim)
	const rail = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.1, 0.05, 10, 64), brass)
	rail.rotation.x = Math.PI / 2
	rail.position.y = TABLE_FACE_Y + 0.05
	rail.userData.collidable = false
	rail.userData.navmesh = false
	group.add(rail)

	// The face, painted as the sky's bed.
	const texture = bare ? null : skyBed()
	const faceMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.15, metalness: 0 })
	if (texture) faceMaterial.map = texture
	const face = new THREE.Mesh(new THREE.CircleGeometry(faceRadius, 64), faceMaterial)
	face.rotation.x = -Math.PI / 2
	face.position.y = TABLE_FACE_Y
	face.receiveShadow = true
	face.userData.collidable = false
	face.userData.navmesh = false
	group.add(face)

	// The stars, and their threads.
	const lights = new THREE.Group()
	lights.position.y = TABLE_FACE_Y
	lights.userData.collidable = false
	lights.userData.navmesh = false
	group.add(lights)
	const count = stars.length
	if (count > 0) {
		const span = radius * 0.82
		const starMesh = new THREE.InstancedMesh(
			new THREE.SphereGeometry(1, 10, 8),
			new THREE.MeshBasicNodeMaterial({ color: '#ffffff' }),
			count,
		)
		const threads = new THREE.InstancedMesh(
			new THREE.CylinderGeometry(0.006, 0.006, 1, 4),
			new THREE.MeshBasicNodeMaterial({ color: '#8fb6ff', transparent: true, opacity: 0.35 }),
			count,
		)
		const m = new THREE.Matrix4()
		const colour = new THREE.Color()
		stars.forEach((star, i) => {
			const x = (star.x - 0.5) * 2 * span
			const z = (star.y - 0.5) * 2 * span
			const h = 0.25 + star.r * 0.6
			const s = 0.06 + star.r * 0.14
			m.makeScale(s, s, s)
			m.setPosition(x, h, z)
			starMesh.setMatrixAt(i, m)
			colour.set(STAR_COLOURS[i % STAR_COLOURS.length] ?? '#ffe6b0')
			starMesh.setColorAt(i, colour)
			m.makeScale(1, h, 1)
			m.setPosition(x, h / 2, z)
			threads.setMatrixAt(i, m)
		})
		starMesh.instanceMatrix.needsUpdate = true
		if (starMesh.instanceColor) starMesh.instanceColor.needsUpdate = true
		threads.instanceMatrix.needsUpdate = true
		for (const mesh of [starMesh, threads]) {
			mesh.userData.collidable = false
			mesh.userData.navmesh = false
			lights.add(mesh)
		}
	}
	const glow = new THREE.PointLight('#9cc4ff', 10, 9, 1.8)
	glow.position.y = 1.4
	lights.add(glow)
	return {
		object: group,
		dispose() {
			texture?.dispose()
			group.traverse((object) => {
				if (object instanceof THREE.Mesh) object.geometry.dispose()
			})
		},
	}
}

/** The report, drawing what is its own: the sky table — bare, when the
 *  space is built bare (atlas island-owners.ts OwnerEntry). */
export function createReportOwner(bare = false): IslandOwner {
	return {
		model(name, props) {
			if (name !== SKY_TABLE_ID) throw new Error(`[${REPORT_OWNER}] no '${name}' to draw`)
			const told = toldSchema.parse(props)
			return buildSkyTable(told.radius, told.stars, bare)
		},
	}
}
