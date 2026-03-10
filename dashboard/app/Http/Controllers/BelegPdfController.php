<?php

namespace App\Http\Controllers;

use App\Models\ImportedBeleg;
use Illuminate\Support\Facades\File;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class BelegPdfController extends Controller
{
    public function __invoke(ImportedBeleg $importedBeleg): BinaryFileResponse
    {
        $path = $importedBeleg->pdfAbsolutePath();

        abort_unless(File::exists($path), 404);

        return response()->file($path, [
            'Content-Type' => 'application/pdf',
        ]);
    }
}
