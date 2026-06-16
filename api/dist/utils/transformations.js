import { clamp } from "lodash-es";

//#region src/utils/transformations.ts
function resolvePreset({ transformationParams, acceptFormat }, file) {
	const transforms = transformationParams.transforms ? [...transformationParams.transforms] : [];
	if (transformationParams.format || transformationParams.quality) transforms.push([
		"toFormat",
		getFormat(file, transformationParams.format, acceptFormat),
		{ quality: transformationParams.quality ? Number(transformationParams.quality) : void 0 }
	]);
	if ((transformationParams.width || transformationParams.height) && file.width && file.height) {
		let toWidth = transformationParams.width ? Number(transformationParams.width) : void 0;
		let toHeight = transformationParams.height ? Number(transformationParams.height) : void 0;
		if (transformationParams.withoutEnlargement) {
			if (toWidth !== void 0) toWidth = Math.min(toWidth, file.width);
			if (toHeight !== void 0) toHeight = Math.min(toHeight, file.height);
		}
		const toFocalPointX = transformationParams.focal_point_x ? Number(transformationParams.focal_point_x) : file.focal_point_x;
		const toFocalPointY = transformationParams.focal_point_y ? Number(transformationParams.focal_point_y) : file.focal_point_y;
		if ((transformationParams.fit === void 0 || transformationParams.fit === "cover") && toWidth && toHeight && toFocalPointX !== null && toFocalPointY !== null) {
			const transformArgs = getResizeArguments({
				w: file.width,
				h: file.height
			}, {
				w: toWidth,
				h: toHeight
			}, {
				x: toFocalPointX,
				y: toFocalPointY
			});
			transforms.push(["resize", {
				width: transformArgs.width,
				height: transformArgs.height,
				fit: transformationParams.fit,
				withoutEnlargement: transformationParams.withoutEnlargement ? Boolean(transformationParams.withoutEnlargement) : void 0
			}], ["extract", transformArgs.region]);
		} else transforms.push(["resize", {
			width: toWidth,
			height: toHeight,
			fit: transformationParams.fit,
			withoutEnlargement: transformationParams.withoutEnlargement ? Boolean(transformationParams.withoutEnlargement) : void 0
		}]);
	}
	return transforms;
}
function getFormat(file, format, acceptFormat) {
	const fileType = file.type?.split("/")[1];
	if (format) {
		if (format !== "auto") return format;
		if (acceptFormat) return acceptFormat;
		if (fileType && [
			"avif",
			"webp",
			"tiff"
		].includes(fileType)) return "png";
	}
	return fileType || "jpg";
}
/**
* Try to extract a file format from an array of `Transformation`'s.
*/
function maybeExtractFormat(transforms) {
	const toFormats = transforms.filter((t) => t[0] === "toFormat");
	const lastToFormat = toFormats[toFormats.length - 1];
	return lastToFormat ? lastToFormat[1]?.toString() : void 0;
}
/**
* Resize an image but keep it centered on the focal point.
* Based on the method outlined in https://github.com/lovell/sharp/issues/1198#issuecomment-384591756
*/
function getResizeArguments(original, target, focalPoint) {
	const { width, height, factor } = getIntermediateDimensions(original, target);
	return {
		width,
		height,
		region: getExtractionRegion(factor, focalPoint ?? {
			x: original.w / 2,
			y: original.h / 2
		}, target, {
			w: width,
			h: height
		})
	};
}
/**
* Calculates the dimensions of the intermediate (resized) image.
*/
function getIntermediateDimensions(original, target) {
	const hRatio = original.h / target.h;
	const wRatio = original.w / target.w;
	let factor;
	let width;
	let height;
	if (hRatio < wRatio) {
		factor = hRatio;
		height = Math.round(target.h);
		width = Math.round(original.w / factor);
	} else {
		factor = wRatio;
		width = Math.round(target.w);
		height = Math.round(original.h / factor);
	}
	return {
		width,
		height,
		factor
	};
}
/**
* Calculates the Region to extract from the intermediate image.
*/
function getExtractionRegion(factor, focalPoint, target, intermediate) {
	const newXCenter = focalPoint.x / factor;
	const newYCenter = focalPoint.y / factor;
	return {
		left: clamp(Math.round(newXCenter - target.w / 2), 0, intermediate.w - target.w),
		top: clamp(Math.round(newYCenter - target.h / 2), 0, intermediate.h - target.h),
		width: target.w,
		height: target.h
	};
}

//#endregion
export { maybeExtractFormat, resolvePreset };