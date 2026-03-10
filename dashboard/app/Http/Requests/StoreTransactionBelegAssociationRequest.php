<?php

namespace App\Http\Requests;

use App\Models\ImportedBeleg;
use App\Models\ImportedTransaction;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreTransactionBelegAssociationRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var ImportedTransaction|null $transaction */
        $transaction = $this->route('importedTransaction');

        return [
            'imported_beleg_id' => [
                'required',
                'integer',
                Rule::exists('imported_belegs', 'id'),
                function (string $attribute, mixed $value, \Closure $fail) use ($transaction): void {
                    if (! $transaction instanceof ImportedTransaction) {
                        return;
                    }

                    $beleg = ImportedBeleg::query()->find($value);

                    if ($beleg instanceof ImportedBeleg && $beleg->source_year !== $transaction->source_year) {
                        $fail('Der Beleg muss aus demselben Jahr wie die Transaktion stammen.');
                    }
                },
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'imported_beleg_id.required' => 'Bitte wähle einen Beleg aus.',
            'imported_beleg_id.exists' => 'Der ausgewählte Beleg wurde nicht gefunden.',
        ];
    }
}
